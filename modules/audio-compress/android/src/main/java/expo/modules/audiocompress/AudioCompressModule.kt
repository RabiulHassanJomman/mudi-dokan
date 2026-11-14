package expo.modules.audiocompress

import android.media.MediaCodec
import android.media.MediaCodecInfo
import android.media.MediaFormat
import android.net.Uri
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.BufferedOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder

/** 16-bit PCM WAV → AAC-LC (ADTS), mono, given bit rate. Runs on Expo's async queue (not the UI thread). */
class AudioCompressModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("AudioCompress")

    AsyncFunction("wavToAac") { input: String, output: String, bitRate: Int ->
      encode(toPath(input), toPath(output), bitRate)
    }
  }

  private fun toPath(p: String): String = if (p.startsWith("file:")) Uri.parse(p).path ?: p else p

  private class Wav(val channels: Int, val sampleRate: Int, val bits: Int, val dataAt: Long, val dataLen: Long)

  private fun readWav(f: RandomAccessFile): Wav {
    val head = ByteArray(12)
    f.readFully(head)
    if (String(head, 0, 4) != "RIFF" || String(head, 8, 4) != "WAVE") throw IllegalArgumentException("not a WAV file")
    var channels = 0
    var rate = 0
    var bits = 0
    var fmt = false
    val chunk = ByteArray(8)
    while (f.filePointer + 8 <= f.length()) {
      f.readFully(chunk)
      val id = String(chunk, 0, 4)
      val len = ByteBuffer.wrap(chunk, 4, 4).order(ByteOrder.LITTLE_ENDIAN).int.toLong() and 0xffffffffL
      if (id == "fmt ") {
        val b = ByteArray(16)
        f.readFully(b)
        val bb = ByteBuffer.wrap(b).order(ByteOrder.LITTLE_ENDIAN)
        if (bb.getShort(0).toInt() != 1) throw IllegalArgumentException("WAV is not PCM")
        channels = bb.getShort(2).toInt()
        rate = bb.getInt(4)
        bits = bb.getShort(14).toInt()
        fmt = true
        f.seek(f.filePointer + (len - 16) + (len % 2))
      } else if (id == "data") {
        if (!fmt) throw IllegalArgumentException("WAV data before fmt")
        val at = f.filePointer
        // a recognizer stopped early may leave a wrong length: take what is there
        return Wav(channels, rate, bits, at, minOf(len, f.length() - at))
      } else {
        f.seek(f.filePointer + len + (len % 2))
      }
    }
    throw IllegalArgumentException("WAV has no data")
  }

  private fun adtsHeader(frameLen: Int, sampleRate: Int, channels: Int): ByteArray {
    val rates = intArrayOf(96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350)
    val freqIdx = rates.indexOf(sampleRate).let { if (it < 0) 8 else it }
    val profile = 2 // AAC LC
    val len = frameLen + 7
    return byteArrayOf(
      0xFF.toByte(),
      0xF1.toByte(),
      (((profile - 1) shl 6) + (freqIdx shl 2) + (channels shr 2)).toByte(),
      (((channels and 3) shl 6) + (len shr 11)).toByte(),
      ((len and 0x7FF) shr 3).toByte(),
      (((len and 7) shl 5) + 0x1F).toByte(),
      0xFC.toByte(),
    )
  }

  private fun encode(input: String, output: String, bitRate: Int): Map<String, Any> {
    val raf = RandomAccessFile(input, "r")
    raf.use { f ->
      val wav = readWav(f)
      if (wav.bits != 16) throw IllegalArgumentException("WAV must be 16-bit")
      val rate = wav.sampleRate
      val format = MediaFormat.createAudioFormat(MediaFormat.MIMETYPE_AUDIO_AAC, rate, 1).apply {
        setInteger(MediaFormat.KEY_AAC_PROFILE, MediaCodecInfo.CodecProfileLevel.AACObjectLC)
        setInteger(MediaFormat.KEY_BIT_RATE, bitRate)
        setInteger(MediaFormat.KEY_MAX_INPUT_SIZE, 16384)
      }
      val codec = MediaCodec.createEncoderByType(MediaFormat.MIMETYPE_AUDIO_AAC)
      val tmp = File("$output.part")
      try {
        codec.configure(format, null, null, MediaCodec.CONFIGURE_FLAG_ENCODE)
        codec.start()
        val out = BufferedOutputStream(FileOutputStream(tmp))
        out.use { o ->
          val frameBytes = 2 * wav.channels
          val totalFrames = wav.dataLen / frameBytes
          var framesRead = 0L
          f.seek(wav.dataAt)
          val readBuf = ByteArray(4096 * frameBytes)
          var inputDone = false
          val info = MediaCodec.BufferInfo()
          var outputDone = false
          while (!outputDone) {
            if (!inputDone) {
              val inIdx = codec.dequeueInputBuffer(10_000)
              if (inIdx >= 0) {
                val inBuf = codec.getInputBuffer(inIdx)!!
                inBuf.clear()
                val maxFrames = minOf((inBuf.capacity() / 2).toLong(), 4096L, totalFrames - framesRead).toInt()
                if (maxFrames <= 0) {
                  val pts = framesRead * 1_000_000L / rate
                  codec.queueInputBuffer(inIdx, 0, 0, pts, MediaCodec.BUFFER_FLAG_END_OF_STREAM)
                  inputDone = true
                } else {
                  f.readFully(readBuf, 0, maxFrames * frameBytes)
                  // down-mix to mono 16-bit little endian
                  val src = ByteBuffer.wrap(readBuf, 0, maxFrames * frameBytes).order(ByteOrder.LITTLE_ENDIAN)
                  inBuf.order(ByteOrder.LITTLE_ENDIAN)
                  for (i in 0 until maxFrames) {
                    var sum = 0
                    for (c in 0 until wav.channels) sum += src.getShort((i * wav.channels + c) * 2).toInt()
                    inBuf.putShort((sum / wav.channels).toShort())
                  }
                  val pts = framesRead * 1_000_000L / rate
                  codec.queueInputBuffer(inIdx, 0, maxFrames * 2, pts, 0)
                  framesRead += maxFrames
                }
              }
            }
            val outIdx = codec.dequeueOutputBuffer(info, 10_000)
            if (outIdx >= 0) {
              val isConfig = (info.flags and MediaCodec.BUFFER_FLAG_CODEC_CONFIG) != 0
              if (!isConfig && info.size > 0) {
                val ob = codec.getOutputBuffer(outIdx)!!
                ob.position(info.offset)
                ob.limit(info.offset + info.size)
                val data = ByteArray(info.size)
                ob.get(data)
                o.write(adtsHeader(info.size, rate, 1))
                o.write(data)
              }
              codec.releaseOutputBuffer(outIdx, false)
              if ((info.flags and MediaCodec.BUFFER_FLAG_END_OF_STREAM) != 0) outputDone = true
            }
          }
          o.flush()
          val dst = File(output)
          if (dst.exists()) dst.delete()
          if (!tmp.renameTo(dst)) throw IllegalStateException("rename failed")
          return mapOf("bytes" to dst.length().toDouble(), "durationMs" to (framesRead * 1000.0 / rate))
        }
      } finally {
        try { codec.stop() } catch (_: Exception) {}
        codec.release()
        if (tmp.exists()) tmp.delete()
      }
    }
  }
}

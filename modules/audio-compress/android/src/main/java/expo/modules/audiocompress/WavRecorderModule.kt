package expo.modules.audiocompress

import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import android.net.Uri
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.sqrt

/**
 * Offline 🎤 (docs/PLAN.md): records one sentence as 16 kHz mono 16-bit PCM WAV, the format
 * Google's recognizer reads from a file later. Stops by itself after `silenceMs` of quiet once
 * speech was heard, after `startTimeoutMs` with no speech, after `maxMs`, or on stop().
 * Speech = a 100 ms frame louder than the room's noise floor by SPEECH_OVER_FLOOR_DB.
 */
class WavRecorderModule : Module() {
  @Volatile private var stopRequested = false
  @Volatile private var running = false

  override fun definition() = ModuleDefinition {
    Name("WavRecorder")

    AsyncFunction("record") { output: String, silenceMs: Int, startTimeoutMs: Int, maxMs: Int, promise: Promise ->
      if (running) {
        promise.reject("BUSY", "already recording", null)
        return@AsyncFunction
      }
      running = true
      stopRequested = false
      Thread {
        try {
          promise.resolve(record(toPath(output), silenceMs, startTimeoutMs, maxMs))
        } catch (e: Exception) {
          File(toPath(output)).delete()
          promise.reject("RECORD_FAILED", e.message ?: "recording failed", e)
        } finally {
          running = false
        }
      }.start()
    }

    Function("stop") {
      stopRequested = true
    }
  }

  private fun toPath(p: String): String = if (p.startsWith("file:")) Uri.parse(p).path ?: p else p

  private fun record(path: String, silenceMs: Int, startTimeoutMs: Int, maxMs: Int): Map<String, Any> {
    val minBuf = AudioRecord.getMinBufferSize(RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    if (minBuf <= 0) throw IllegalStateException("no recorder for 16 kHz mono")
    val rec = try {
      AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION, RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, max(minBuf, FRAME * 2 * 4))
    } catch (e: SecurityException) {
      throw IllegalStateException("no microphone permission")
    }
    if (rec.state != AudioRecord.STATE_INITIALIZED) {
      rec.release()
      throw IllegalStateException("microphone not available")
    }
    val file = File(path)
    file.parentFile?.mkdirs()
    val out = FileOutputStream(file)
    out.write(ByteArray(44)) // header written at the end, when the length is known
    val shorts = ShortArray(FRAME)
    val bytes = ByteBuffer.allocate(FRAME * 2).order(ByteOrder.LITTLE_ENDIAN)
    val startedAt = System.currentTimeMillis()
    var samples = 0L
    var floor = Double.NaN
    var heard = false
    var loudRun = 0
    var quietMs = 0
    var why = "stop"
    try {
      rec.startRecording()
      while (true) {
        if (stopRequested) { why = "stop"; break }
        var got = 0
        while (got < FRAME) {
          val n = rec.read(shorts, got, FRAME - got)
          if (n <= 0) throw IllegalStateException("microphone read failed ($n)")
          got += n
        }
        bytes.clear()
        var sum = 0.0
        for (s in shorts) {
          bytes.putShort(s)
          sum += s.toDouble() * s.toDouble()
        }
        out.write(bytes.array(), 0, FRAME * 2)
        samples += FRAME
        val db = 20 * log10(max(sqrt(sum / FRAME), 1.0) / 32768.0)
        if (floor.isNaN()) floor = db
        val loud = db > max(floor + SPEECH_OVER_FLOOR_DB, MIN_SPEECH_DB)
        if (loud) {
          loudRun++
          quietMs = 0
          if (loudRun >= 2) heard = true
        } else {
          loudRun = 0
          quietMs += FRAME_MS
          // the room's noise: follows quiet frames slowly, drops at once
          floor = if (db < floor) db else floor * 0.95 + db * 0.05
        }
        val elapsed = (samples * 1000 / RATE).toInt()
        if (heard && quietMs >= silenceMs) { why = "silence"; break }
        if (!heard && elapsed >= startTimeoutMs) { why = "nothing"; break }
        if (elapsed >= maxMs) { why = "max"; break }
      }
    } finally {
      try { rec.stop() } catch (_: Exception) {}
      rec.release()
      out.close()
    }
    writeHeader(file, samples)
    return mapOf(
      "uri" to Uri.fromFile(file).toString(),
      "durationMs" to (samples * 1000 / RATE).toDouble(),
      "heard" to heard,
      "startedAt" to startedAt.toDouble(),
      "why" to why,
    )
  }

  private fun writeHeader(file: File, samples: Long) {
    val dataLen = samples * 2
    val h = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN)
    h.put("RIFF".toByteArray()).putInt((36 + dataLen).toInt()).put("WAVE".toByteArray())
    h.put("fmt ".toByteArray()).putInt(16).putShort(1).putShort(1).putInt(RATE).putInt(RATE * 2).putShort(2).putShort(16)
    h.put("data".toByteArray()).putInt(dataLen.toInt())
    RandomAccessFile(file, "rw").use {
      it.seek(0)
      it.write(h.array())
    }
  }

  companion object {
    private const val RATE = 16000
    private const val FRAME_MS = 100
    private const val FRAME = RATE * FRAME_MS / 1000
    private const val SPEECH_OVER_FLOOR_DB = 12.0
    private const val MIN_SPEECH_DB = -50.0
  }
}

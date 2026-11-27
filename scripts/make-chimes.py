"""Makes the বলুন chimes: assets/sounds/chime.wav (rising: speak now) and chime-end.wav (falling: done).

Soft: sine notes an octave lower than before (E5, B5), peak 0.18, a 15 ms fade-in, a gentle fade-out.
Run: python3 scripts/make-chimes.py
"""
import math, struct, wave

RATE = 22050
PEAK = 0.18
NOTE_S = 0.16  # each note; the chime is 0.32 s (BEEP_MS in say.tsx waits for it)
E5, B5 = 659.25, 987.77


def note(freq):
    n = int(RATE * NOTE_S)
    out = []
    for i in range(n):
        t = i / RATE
        attack = min(1.0, t / 0.015)
        decay = math.exp(-t * 9)
        out.append(PEAK * attack * decay * math.sin(2 * math.pi * freq * t))
    return out


def write(path, freqs):
    samples = [s for f in freqs for s in note(f)]
    # ends at silence: a short fade so there's no click
    fade = int(RATE * 0.01)
    for i in range(fade):
        samples[-1 - i] *= i / fade
    with wave.open(path, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b''.join(struct.pack('<h', int(s * 32767)) for s in samples))


write('assets/sounds/chime.wav', [E5, B5])
write('assets/sounds/chime-end.wav', [B5, E5])

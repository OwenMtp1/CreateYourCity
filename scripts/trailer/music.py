"""Bande-son originale de la bande-annonce, synthétisée (aucun échantillon externe).

Usage : python3 music.py <durée_en_secondes> <sortie.wav>
Progression La m - Fa - Do - Sol à 96 BPM : nappes, basse, arpège, percussions à partir
du deuxième tiers, montée avant le final, accord final et fondu.
"""
import sys
import wave

import numpy as np

SR = 44100
BPM = 96.0
BEAT = 60.0 / BPM


def midi(n: float) -> float:
    return 440.0 * 2 ** ((n - 69) / 12)


def lowpass(x: np.ndarray, cutoff: float) -> np.ndarray:
    """Filtre passe-bas à un pôle (deux passages pour adoucir)."""
    a = np.exp(-2 * np.pi * cutoff / SR)
    for _ in range(2):
        y = np.empty_like(x)
        acc = 0.0
        b = 1 - a
        for i in range(len(x)):
            acc = b * x[i] + a * acc
            y[i] = acc
        x = y
    return x


def saw(f: float, t: np.ndarray) -> np.ndarray:
    return 2 * ((f * t) % 1.0) - 1


def envelope(n: int, attack: float, release: float) -> np.ndarray:
    env = np.ones(n)
    a = int(attack * SR)
    r = int(release * SR)
    if a:
        env[:a] = np.linspace(0, 1, a)
    if r:
        env[-r:] *= np.linspace(1, 0, r)
    return env


def main(duration: float, out: str) -> None:
    n = int(duration * SR)
    t = np.arange(n) / SR
    left = np.zeros(n)
    right = np.zeros(n)
    chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]  # Am F C G
    bar = 4 * BEAT
    drums_start = duration * 0.3
    riser_start = duration * 0.62
    final = duration - 5.5

    # Nappes et basse, un accord par mesure ; accord final tenu.
    pos = 0.0
    k = 0
    while pos < duration:
        chord = chords[k % 4] if pos < final else [57, 60, 64, 69]
        length = bar if pos < final else duration - pos
        i0 = int(pos * SR)
        i1 = min(n, int((pos + length) * SR))
        seg_t = t[i0:i1] - pos
        env = envelope(i1 - i0, 0.6 if k else 2.5, min(1.2, length / 2))
        pad = np.zeros(i1 - i0)
        for note in chord:
            for det in (-0.08, 0.0, 0.07):
                pad += saw(midi(note + det) * 1.0, seg_t)
        pad = lowpass(pad / 9.0, 900 if pos < riser_start else 1800) * env
        bass = np.sin(2 * np.pi * midi(chord[0] - 24) * seg_t) * env * 0.55
        left[i0:i1] += pad * 0.32 + bass
        right[i0:i1] += pad * 0.28 + bass
        pos += length
        k += 1

    # Arpège (croches), panoramique alterné.
    step = BEAT / 2
    j = 0
    pos = BEAT * 4
    while pos < final:
        chord = chords[int(pos // bar) % 4]
        note = chord[[0, 1, 2, 1][j % 4]] + 12
        i0 = int(pos * SR)
        ln = int(0.35 * SR)
        i1 = min(n, i0 + ln)
        seg_t = np.arange(i1 - i0) / SR
        tone = (np.sin(2 * np.pi * midi(note) * seg_t) + 0.3 * np.sin(4 * np.pi * midi(note) * seg_t)) * np.exp(-seg_t * 9)
        gain = 0.16 if pos > drums_start else 0.1
        pan = 0.65 if j % 2 else 0.35
        left[i0:i1] += tone * gain * (1 - pan) * 2
        right[i0:i1] += tone * gain * pan * 2
        pos += step
        j += 1

    # Percussions : grosse caisse sur les temps, caisse claire sur 2 et 4.
    rng = np.random.default_rng(7)
    pos = drums_start - drums_start % BEAT
    b = 0
    while pos < final:
        i0 = int(pos * SR)
        ln = int(0.4 * SR)
        i1 = min(n, i0 + ln)
        seg_t = np.arange(i1 - i0) / SR
        kick = np.sin(2 * np.pi * (50 + 90 * np.exp(-seg_t * 30)) * seg_t) * np.exp(-seg_t * 8) * 0.9
        left[i0:i1] += kick
        right[i0:i1] += kick
        if b % 2 == 1:
            noise = rng.standard_normal(i1 - i0) * np.exp(-seg_t * 18) * 0.25
            left[i0:i1] += noise
            right[i0:i1] += noise
        pos += BEAT
        b += 1

    # Montée (bruit filtré croissant) avant le final, puis impact.
    i0 = int(riser_start * SR)
    i1 = int(final * SR)
    if i1 > i0:
        noise = lowpass(rng.standard_normal(i1 - i0), 2500) * np.linspace(0, 0.5, i1 - i0) ** 2
        left[i0:i1] += noise
        right[i0:i1] += noise
    i0 = int(final * SR)
    seg_t = np.arange(min(n - i0, int(3 * SR))) / SR
    boom = np.sin(2 * np.pi * (40 + 60 * np.exp(-seg_t * 6)) * seg_t) * np.exp(-seg_t * 1.5) * 1.1
    left[i0:i0 + len(boom)] += boom
    right[i0:i0 + len(boom)] += boom

    # Fondu d'entrée/sortie et normalisation.
    fade = envelope(n, 1.0, 3.0)
    stereo = np.stack([left * fade, right * fade], axis=1)
    stereo /= np.max(np.abs(stereo)) / 0.89
    data = (stereo * 32767).astype(np.int16)
    with wave.open(out, 'wb') as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data.tobytes())


if __name__ == '__main__':
    main(float(sys.argv[1]), sys.argv[2])

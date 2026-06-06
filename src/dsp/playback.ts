import type { Chord } from "./harmony";
import { NOTE_VALUE_BEATS, noteFrequency, type Phrase } from "./quantize";
import { voiceChord } from "./voicing";

/** One scheduled note: when it starts, how long it sounds, and at what pitch. */
export interface ScheduledNote {
	/** Frequency in Hz. */
	frequency: number;
	/** Seconds from the phrase start (before adding the AudioContext base time). */
	startSec: number;
	/** Sounding duration in seconds. */
	durationSec: number;
}

/**
 * Turn a quantized {@link Phrase} into oscillator-ready timings. Pure — every
 * start/duration is derived from the phrase's own beat grid and tempo, so the
 * caller can offset them against a single `AudioContext.currentTime` base with
 * zero accumulated scheduling drift.
 */
export function buildSchedule(phrase: Phrase): ScheduledNote[] {
	const secondsPerBeat = 60 / phrase.bpm;
	return phrase.notes.map((note) => ({
		frequency: noteFrequency(note),
		startSec: note.beatPosition * secondsPerBeat,
		durationSec: NOTE_VALUE_BEATS[note.noteValue] * secondsPerBeat,
	}));
}

/** Total wall-clock seconds the phrase occupies (last note's end). */
export function scheduleDuration(schedule: ScheduledNote[]): number {
	return schedule.reduce(
		(end, note) => Math.max(end, note.startSec + note.durationSec),
		0,
	);
}

/**
 * Build an accompaniment schedule from a chord progression.
 *
 * Each chord is voiced via {@link voiceChord} (bass at octave 2, triad at
 * octave 3) and mapped to four {@link ScheduledNote} entries — one bass note
 * plus three triad tones — all sharing the chord's start time and full
 * duration.  The same 60/bpm beat-to-second conversion is used here as in
 * {@link buildSchedule}, so melody and accompaniment share one time base with
 * zero drift.
 *
 * Pure — empty input returns an empty array.
 */
export function buildAccompanimentSchedule(
	chords: Chord[],
	bpm: number,
): ScheduledNote[] {
	if (chords.length === 0) return [];
	const secondsPerBeat = 60 / bpm;
	const notes: ScheduledNote[] = [];

	for (const chord of chords) {
		const startSec = chord.beatPosition * secondsPerBeat;
		const durationSec = chord.beats * secondsPerBeat;
		const { bass, triad } = voiceChord(chord);

		notes.push({ frequency: noteFrequency(bass), startSec, durationSec });
		for (const tone of triad) {
			notes.push({ frequency: noteFrequency(tone), startSec, durationSec });
		}
	}

	return notes;
}

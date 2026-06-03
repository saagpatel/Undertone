import { NOTE_VALUE_BEATS, noteFrequency, type Phrase } from "./quantize";

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

import type { RawPhrase } from "./capture";

/**
 * Maps a {@link RawPhrase} (median frequencies + raw millisecond timings) onto a
 * musical {@link Phrase}: chromatic pitch + octave, a quantized note value, and
 * a beat position on a 16th-note grid. Pure — the same input always yields the
 * same phrase.
 */

export type NoteName = "C" | "D" | "E" | "F" | "G" | "A" | "B";
export type Accidental = "sharp" | "flat" | null;
export type NoteValue = "whole" | "half" | "quarter" | "eighth" | "sixteenth";

export interface NoteEvent {
	pitch: NoteName;
	accidental: Accidental;
	octave: number;
	noteValue: NoteValue;
	/** Quarter-note units from phrase start; multiples of 0.25. */
	beatPosition: number;
}

export interface Phrase {
	notes: NoteEvent[];
	timeSignatureNumerator: number;
	timeSignatureDenominator: number;
	bpm: number;
}

export interface QuantizeOpts {
	bpm?: number;
	timeSignatureNumerator?: number;
	timeSignatureDenominator?: number;
}

export const DEFAULT_BPM = 90;

/** Each note value's length in quarter-note beats. */
export const NOTE_VALUE_BEATS: Record<NoteValue, number> = {
	whole: 4,
	half: 2,
	quarter: 1,
	eighth: 0.5,
	sixteenth: 0.25,
};

/** Sharp spelling for each chromatic pitch class (index 0 = C). */
const PITCH_CLASSES: ReadonlyArray<{
	pitch: NoteName;
	accidental: Accidental;
}> = [
	{ pitch: "C", accidental: null },
	{ pitch: "C", accidental: "sharp" },
	{ pitch: "D", accidental: null },
	{ pitch: "D", accidental: "sharp" },
	{ pitch: "E", accidental: null },
	{ pitch: "F", accidental: null },
	{ pitch: "F", accidental: "sharp" },
	{ pitch: "G", accidental: null },
	{ pitch: "G", accidental: "sharp" },
	{ pitch: "A", accidental: null },
	{ pitch: "A", accidental: "sharp" },
	{ pitch: "B", accidental: null },
];

const SIXTEENTH_BEATS = 0.25;
/** Onset must land within this fraction of a 16th-note to snap to the grid. */
export const BEAT_SNAP_TOLERANCE = 0.2;

/** Frequency -> chromatic pitch via the MIDI number 69 + 12·log2(f/440). */
export function frequencyToPitch(frequency: number): {
	pitch: NoteName;
	accidental: Accidental;
	octave: number;
} {
	const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
	const pitchClass = ((midi % 12) + 12) % 12;
	const octave = Math.floor(midi / 12) - 1;
	const spelling = PITCH_CLASSES[pitchClass];
	return { pitch: spelling.pitch, accidental: spelling.accidental, octave };
}

/** Nearest note value to a raw duration, compared in log space (musical ratio). */
export function durationToNoteValue(
	durationMs: number,
	bpm: number,
): NoteValue {
	const quarterMs = 60000 / bpm;
	let best: NoteValue = "quarter";
	let bestDistance = Infinity;
	for (const value of Object.keys(NOTE_VALUE_BEATS) as NoteValue[]) {
		const canonicalMs = NOTE_VALUE_BEATS[value] * quarterMs;
		const distance = Math.abs(Math.log2(durationMs / canonicalMs));
		if (distance < bestDistance) {
			bestDistance = distance;
			best = value;
		}
	}
	return best;
}

export function quantizePhrase(
	raw: RawPhrase,
	opts: QuantizeOpts = {},
): Phrase {
	const bpm = opts.bpm ?? DEFAULT_BPM;
	const timeSignatureNumerator = opts.timeSignatureNumerator ?? 4;
	const timeSignatureDenominator = opts.timeSignatureDenominator ?? 4;
	const quarterMs = 60000 / bpm;

	const meta = { timeSignatureNumerator, timeSignatureDenominator, bpm };
	if (raw.length === 0) return { notes: [], ...meta };

	const phraseStartMs = raw[0].onsetMs;

	let gridMisses = 0;
	const gridNotes: NoteEvent[] = raw.map((note) => {
		const beats = (note.onsetMs - phraseStartMs) / quarterMs;
		const steps = Math.round(beats / SIXTEENTH_BEATS);
		const snapped = steps * SIXTEENTH_BEATS;
		if (Math.abs(beats - snapped) > BEAT_SNAP_TOLERANCE * SIXTEENTH_BEATS)
			gridMisses++;
		return {
			...frequencyToPitch(note.frequency),
			noteValue: durationToNoteValue(note.durationMs, bpm),
			beatPosition: snapped,
		};
	});

	// If most onsets miss the tempo grid (freeform humming), abandon the grid and
	// lay notes back-to-back by their own durations — always readable.
	if (gridMisses / raw.length >= 0.5) {
		let cursor = 0;
		const sequential = gridNotes.map((note) => {
			const placed: NoteEvent = { ...note, beatPosition: cursor };
			cursor += NOTE_VALUE_BEATS[note.noteValue];
			return placed;
		});
		return { notes: sequential, ...meta };
	}

	return { notes: gridNotes, ...meta };
}

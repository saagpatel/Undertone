import type { Accidental, NoteName, NoteValue, Phrase } from "./quantize";

/**
 * Key detection via Krumhansl-Schmuckler pitch-class profile correlation.
 *
 * Build a 12-bin pitch-class histogram weighted by each note's beat duration,
 * then correlate against the 24 canonical K-S profiles (12 major + 12 minor)
 * and return the best-matching key.
 *
 * Pure function — same Phrase always yields the same Key.
 */

export type Mode = "major" | "minor";

export interface Key {
	tonic: NoteName;
	/** Sharp/flat in the tonic spelling (e.g. F# major → tonic "F", accidental "sharp"). */
	accidental: Accidental;
	mode: Mode;
}

// ─── Krumhansl-Schmuckler profiles ───────────────────────────────────────────

/**
 * Original Krumhansl (1990) key profiles, starting on C (pitch class 0).
 * These are widely used; they characterise how well each scale degree fits the
 * perceived key of that tonic.
 */
const KS_MAJOR: readonly number[] = [
	6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88,
];

const KS_MINOR: readonly number[] = [
	6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17,
];

// ─── Pitch-class helpers ──────────────────────────────────────────────────────

/** Semitone offset above C for each natural note name. */
const NATURAL_SEMITONES: Record<NoteName, number> = {
	C: 0,
	D: 2,
	E: 4,
	F: 5,
	G: 7,
	A: 9,
	B: 11,
};

/** Accidental adjustment in semitones. */
function accidentalOffset(acc: Accidental): number {
	if (acc === "sharp") return 1;
	if (acc === "flat") return -1;
	return 0;
}

/** Pitch class (0–11) from a note's pitch + accidental. */
function pitchClass(pitch: NoteName, accidental: Accidental): number {
	return (
		(((NATURAL_SEMITONES[pitch] + accidentalOffset(accidental)) % 12) + 12) % 12
	);
}

// ─── Note value durations ─────────────────────────────────────────────────────

const NOTE_BEATS: Record<NoteValue, number> = {
	whole: 4,
	half: 2,
	quarter: 1,
	eighth: 0.5,
	sixteenth: 0.25,
};

// ─── Tonic spellings per pitch class ──────────────────────────────────────────

/**
 * Conventional tonic spelling for each pitch class (0 = C … 11 = B), indexed by
 * mode. Each entry is the real-world key whose tonic is that pitch class, spelled
 * to minimise accidentals (e.g. pc 1 major → Db, not C#; pc 10 major → Bb, not
 * A#). Enharmonic ties (pc 6 major, pc 3 minor) resolve to the more common
 * spelling. Every listed key needs only single accidentals, so the diatonic
 * scale built from any of these tonics stays within the {sharp, flat, natural}
 * vocabulary the {@link Accidental} type can express.
 */
const TONIC_SPELLING: Record<
	Mode,
	ReadonlyArray<{ pitch: NoteName; accidental: Accidental }>
> = {
	major: [
		{ pitch: "C", accidental: null }, // 0  C
		{ pitch: "D", accidental: "flat" }, // 1  Db
		{ pitch: "D", accidental: null }, // 2  D
		{ pitch: "E", accidental: "flat" }, // 3  Eb
		{ pitch: "E", accidental: null }, // 4  E
		{ pitch: "F", accidental: null }, // 5  F
		{ pitch: "F", accidental: "sharp" }, // 6  F# (≡ Gb)
		{ pitch: "G", accidental: null }, // 7  G
		{ pitch: "A", accidental: "flat" }, // 8  Ab
		{ pitch: "A", accidental: null }, // 9  A
		{ pitch: "B", accidental: "flat" }, // 10 Bb
		{ pitch: "B", accidental: null }, // 11 B
	],
	minor: [
		{ pitch: "C", accidental: null }, // 0  Cm
		{ pitch: "C", accidental: "sharp" }, // 1  C#m
		{ pitch: "D", accidental: null }, // 2  Dm
		{ pitch: "E", accidental: "flat" }, // 3  Ebm (≡ D#m)
		{ pitch: "E", accidental: null }, // 4  Em
		{ pitch: "F", accidental: null }, // 5  Fm
		{ pitch: "F", accidental: "sharp" }, // 6  F#m
		{ pitch: "G", accidental: null }, // 7  Gm
		{ pitch: "G", accidental: "sharp" }, // 8  G#m
		{ pitch: "A", accidental: null }, // 9  Am
		{ pitch: "B", accidental: "flat" }, // 10 Bbm
		{ pitch: "B", accidental: null }, // 11 Bm
	],
};

// ─── Correlation helper ───────────────────────────────────────────────────────

/**
 * Pearson correlation between two equal-length numeric arrays.
 * Returns 0 for degenerate inputs (zero variance).
 */
function pearson(x: readonly number[], y: readonly number[]): number {
	const n = x.length;
	const meanX = x.reduce((s, v) => s + v, 0) / n;
	const meanY = y.reduce((s, v) => s + v, 0) / n;
	let num = 0;
	let varX = 0;
	let varY = 0;
	for (let i = 0; i < n; i++) {
		const dx = x[i] - meanX;
		const dy = y[i] - meanY;
		num += dx * dy;
		varX += dx * dx;
		varY += dy * dy;
	}
	const denom = Math.sqrt(varX * varY);
	return denom === 0 ? 0 : num / denom;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Detect the key of a {@link Phrase} using Krumhansl-Schmuckler.
 *
 * For an empty phrase, returns C major (a deterministic, reasonable default).
 */
export function detectKey(phrase: Phrase): Key {
	// 1. Build a duration-weighted 12-bin pitch-class histogram.
	// The first note receives extra weight (×3) as the strongest tonal anchor —
	// this breaks relative-key ties (e.g. C major vs A minor) in the direction of
	// the melody's opening pitch without distorting clear-cut keys.
	const histogram = new Array<number>(12).fill(0);
	for (let i = 0; i < phrase.notes.length; i++) {
		const note = phrase.notes[i];
		const pc = pitchClass(note.pitch, note.accidental);
		const baseWeight = NOTE_BEATS[note.noteValue];
		histogram[pc] += i === 0 ? baseWeight * 3 : baseWeight;
	}

	// Edge case: all-silence/empty phrase — default to C major.
	const total = histogram.reduce((s, v) => s + v, 0);
	if (total === 0) {
		return { tonic: "C", accidental: null, mode: "major" };
	}

	// 2. Correlate against all 24 rotated key profiles and pick the best.
	let bestCorr = -Infinity;
	let bestPc = 0;
	let bestMode: Mode = "major";

	for (let tonic = 0; tonic < 12; tonic++) {
		// Rotate the histogram so tonic lands at bin 0, then correlate.
		const rotated = Array.from(
			{ length: 12 },
			(_, i) => histogram[(i + tonic) % 12],
		);

		const corrMaj = pearson(rotated, KS_MAJOR);
		if (corrMaj > bestCorr) {
			bestCorr = corrMaj;
			bestPc = tonic;
			bestMode = "major";
		}

		const corrMin = pearson(rotated, KS_MINOR);
		if (corrMin > bestCorr) {
			bestCorr = corrMin;
			bestPc = tonic;
			bestMode = "minor";
		}
	}

	const { pitch, accidental } = TONIC_SPELLING[bestMode][bestPc];
	return { tonic: pitch, accidental, mode: bestMode };
}

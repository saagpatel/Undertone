import { describe, expect, it } from "vitest";
import { chordSymbol, harmonize } from "./harmony";
import type { Key } from "./key";
import type { Phrase } from "./quantize";

// ─── Helpers ────────────────────────────────────────────────────────────────

function makePhrase(
	notes: Array<
		[
			"C" | "D" | "E" | "F" | "G" | "A" | "B",
			null | "sharp" | "flat",
			number,
			number, // beatPosition
		]
	>,
	bpm = 90,
): Phrase {
	return {
		notes: notes.map(([pitch, accidental, octave, beatPosition]) => ({
			pitch,
			accidental,
			octave,
			noteValue: "quarter" as const,
			beatPosition,
		})),
		timeSignatureNumerator: 4,
		timeSignatureDenominator: 4,
		bpm,
	};
}

const C_MAJOR: Key = { tonic: "C", accidental: null, mode: "major" };
const A_MINOR: Key = { tonic: "A", accidental: null, mode: "minor" };
const G_MAJOR: Key = { tonic: "G", accidental: null, mode: "major" };
const F_MAJOR: Key = { tonic: "F", accidental: null, mode: "major" };

// ─── Tests — harmonize ───────────────────────────────────────────────────────

describe("harmonize", () => {
	it("returns empty array for empty phrase", () => {
		const phrase: Phrase = {
			notes: [],
			timeSignatureNumerator: 4,
			timeSignatureDenominator: 4,
			bpm: 90,
		};
		expect(harmonize(phrase, C_MAJOR)).toEqual([]);
	});

	it("every chord is diatonic to C major", () => {
		// One measure (beats 0-3): C E G C
		const phrase = makePhrase([
			["C", null, 4, 0],
			["E", null, 4, 1],
			["G", null, 4, 2],
			["C", null, 5, 3],
		]);
		const chords = harmonize(phrase, C_MAJOR);
		expect(chords.length).toBeGreaterThan(0);
		// Every chord tone must be in the C-major diatonic set (no accidentals)
		const cMajorPCs = new Set([0, 2, 4, 5, 7, 9, 11]); // C D E F G A B
		for (const chord of chords) {
			for (const tone of chord.tones) {
				const semis: Record<string, number> = {
					C: 0,
					D: 2,
					E: 4,
					F: 5,
					G: 7,
					A: 9,
					B: 11,
				};
				const acc =
					tone.accidental === "sharp" ? 1 : tone.accidental === "flat" ? -1 : 0;
				const pc = (((semis[tone.pitch] + acc) % 12) + 12) % 12;
				expect(cMajorPCs.has(pc)).toBe(true);
			}
		}
	});

	it("first chord contains the melody's opening note when that note is a chord tone", () => {
		// Melody opens on C4 (beat 0) in C major — I chord (C E G) contains C
		const phrase = makePhrase([
			["C", null, 4, 0],
			["D", null, 4, 1],
			["E", null, 4, 2],
			["G", null, 4, 3],
		]);
		const chords = harmonize(phrase, C_MAJOR);
		const firstChord = chords[0];
		const firstChordPitches = firstChord.tones.map((t) => t.pitch);
		expect(firstChordPitches).toContain("C");
	});

	it("final two chords form an authentic or plagal cadence in C major", () => {
		// Two measures of melody: ends on C (tonic)
		const phrase = makePhrase([
			["C", null, 4, 0],
			["E", null, 4, 1],
			["G", null, 4, 2],
			["F", null, 4, 3],
			["G", null, 4, 4],
			["B", null, 4, 5],
			["D", null, 5, 6],
			["C", null, 5, 7],
		]);
		const chords = harmonize(phrase, C_MAJOR);
		expect(chords.length).toBeGreaterThanOrEqual(2);
		const last = chords[chords.length - 1];
		const penultimate = chords[chords.length - 2];
		// Authentic cadence: V (degree 5) → I (degree 1)
		// Plagal cadence: IV (degree 4) → I (degree 1)
		expect(last.degree).toBe(1); // final chord is tonic
		expect([4, 5]).toContain(penultimate.degree); // penultimate is IV or V
	});

	it("final cadence is present on a short single-measure phrase", () => {
		const phrase = makePhrase([
			["C", null, 4, 0],
			["G", null, 4, 1],
		]);
		const chords = harmonize(phrase, C_MAJOR);
		expect(chords.length).toBeGreaterThanOrEqual(1);
		const last = chords[chords.length - 1];
		// Last chord must resolve to tonic (I)
		expect(last.degree).toBe(1);
	});

	it("harmonizes in A minor (all chords diatonic to A natural minor)", () => {
		// A minor diatonic PCs: A=9 B=11 C=0 D=2 E=4 F=5 G=7
		const phrase = makePhrase([
			["A", null, 3, 0],
			["C", null, 4, 1],
			["E", null, 4, 2],
			["A", null, 4, 3],
		]);
		const chords = harmonize(phrase, A_MINOR);
		expect(chords.length).toBeGreaterThan(0);
		const aMinorPCs = new Set([9, 11, 0, 2, 4, 5, 7]);
		for (const chord of chords) {
			for (const tone of chord.tones) {
				const semis: Record<string, number> = {
					C: 0,
					D: 2,
					E: 4,
					F: 5,
					G: 7,
					A: 9,
					B: 11,
				};
				const acc =
					tone.accidental === "sharp" ? 1 : tone.accidental === "flat" ? -1 : 0;
				const pc = (((semis[tone.pitch] + acc) % 12) + 12) % 12;
				expect(aMinorPCs.has(pc)).toBe(true);
			}
		}
	});

	it("spells flat scale degrees correctly in F major (Bb, never A#)", () => {
		// Two measures. Slot 0 (penultimate) melody outlines the IV triad Bb-D-F so
		// the plagal cadence picks IV; slot 1 resolves to the F-major tonic.
		// Regression guard for the all-sharp spelling bug: F major's only accidental
		// is Bb, so no emitted tone may carry a sharp.
		const phrase = makePhrase([
			["B", "flat", 4, 0],
			["D", null, 5, 1],
			["F", null, 5, 2],
			["F", null, 4, 4],
			["A", null, 4, 5],
			["C", null, 5, 6],
			["F", null, 4, 7],
		]);
		const chords = harmonize(phrase, F_MAJOR);
		expect(chords).toHaveLength(2);

		const [penultimate, last] = chords;
		expect(penultimate.degree).toBe(4); // IV
		expect(penultimate.root).toEqual({ pitch: "B", accidental: "flat" });
		expect(penultimate.symbol).toBe("Bb");
		expect(last.degree).toBe(1); // I
		expect(last.symbol).toBe("F");

		// No chord tone anywhere is spelled with a sharp.
		for (const chord of chords) {
			for (const tone of chord.tones) {
				expect(tone.accidental).not.toBe("sharp");
			}
		}
	});

	it("spans the latest-ending note even when notes are not sorted by beat", () => {
		// Array order puts the beat-4 note first and the beat-0 note last. A naive
		// "last element = phrase end" would truncate the span to one beat and drop
		// the beat-4 note; harmonize must cover the full span regardless of order.
		const phrase = makePhrase([
			["G", null, 4, 4],
			["C", null, 4, 0],
		]);
		const chords = harmonize(phrase, C_MAJOR);
		const lastChord = chords[chords.length - 1];
		expect(lastChord.beatPosition).toBeGreaterThanOrEqual(4);
	});

	it("beat positions are non-decreasing and within the phrase span", () => {
		const phrase = makePhrase([
			["C", null, 4, 0],
			["E", null, 4, 1],
			["G", null, 4, 2],
			["C", null, 5, 3],
		]);
		const chords = harmonize(phrase, C_MAJOR);
		for (let i = 1; i < chords.length; i++) {
			expect(chords[i].beatPosition).toBeGreaterThanOrEqual(
				chords[i - 1].beatPosition,
			);
		}
		// All chord positions within the phrase duration
		const phraseEnd = 3 + 1; // last beat + 1 quarter
		for (const chord of chords) {
			expect(chord.beatPosition).toBeGreaterThanOrEqual(0);
			expect(chord.beatPosition).toBeLessThan(phraseEnd);
		}
	});
});

// ─── Tests — chordSymbol ─────────────────────────────────────────────────────

describe("chordSymbol", () => {
	// chordSymbol is a pure function of the chord's root + quality, so test it
	// directly rather than fishing a particular degree out of harmonize() output.
	it("major triad → bare letter", () => {
		expect(
			chordSymbol(
				{ root: { pitch: "C", accidental: null }, quality: "major" },
				C_MAJOR,
			),
		).toBe("C");
	});

	it("minor triad → letter + 'm'", () => {
		expect(
			chordSymbol(
				{ root: { pitch: "A", accidental: null }, quality: "minor" },
				C_MAJOR,
			),
		).toBe("Am");
	});

	it("diminished triad → letter + 'dim'", () => {
		expect(
			chordSymbol(
				{ root: { pitch: "B", accidental: null }, quality: "dim" },
				C_MAJOR,
			),
		).toBe("Bdim");
	});

	it("flat root → letter + 'b'", () => {
		expect(
			chordSymbol(
				{ root: { pitch: "B", accidental: "flat" }, quality: "major" },
				F_MAJOR,
			),
		).toBe("Bb");
	});

	it("sharp root → letter + '#'", () => {
		expect(
			chordSymbol(
				{ root: { pitch: "F", accidental: "sharp" }, quality: "minor" },
				G_MAJOR,
			),
		).toBe("F#m");
	});

	it("labels the tonic of a harmonized phrase (integration)", () => {
		// The final chord is always the tonic — guaranteed to exist.
		const chords = harmonize(makePhrase([["C", null, 4, 0]]), C_MAJOR);
		const tonic = chords[chords.length - 1];
		expect(tonic.degree).toBe(1);
		expect(chordSymbol(tonic, C_MAJOR)).toBe("C");
	});
});

import { describe, expect, it } from "vitest";
import { detectKey } from "./key";
import type { Phrase } from "./quantize";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build a Phrase from a list of [pitch, octave] pairs, each a quarter note. */
function makePhrase(
	notes: Array<
		["C" | "D" | "E" | "F" | "G" | "A" | "B", null | "sharp" | "flat", number]
	>,
): Phrase {
	return {
		notes: notes.map(([pitch, accidental, octave], i) => ({
			pitch,
			accidental,
			octave,
			noteValue: "quarter" as const,
			beatPosition: i,
		})),
		timeSignatureNumerator: 4,
		timeSignatureDenominator: 4,
		bpm: 90,
	};
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("detectKey", () => {
	it("detects C major from a full C-major scale", () => {
		const phrase = makePhrase([
			["C", null, 4],
			["D", null, 4],
			["E", null, 4],
			["F", null, 4],
			["G", null, 4],
			["A", null, 4],
			["B", null, 4],
		]);
		const key = detectKey(phrase);
		expect(key.tonic).toBe("C");
		expect(key.mode).toBe("major");
	});

	it("detects A minor from a full A-minor scale (natural)", () => {
		// A B C D E F G — all naturals
		const phrase = makePhrase([
			["A", null, 3],
			["B", null, 3],
			["C", null, 4],
			["D", null, 4],
			["E", null, 4],
			["F", null, 4],
			["G", null, 4],
		]);
		const key = detectKey(phrase);
		expect(key.tonic).toBe("A");
		expect(key.mode).toBe("minor");
	});

	it("detects G major from a G-major melody", () => {
		// G major uses F# — include at least one F# to tip the correlation
		const phrase = makePhrase([
			["G", null, 4],
			["A", null, 4],
			["B", null, 4],
			["C", null, 5],
			["D", null, 5],
			["E", null, 5],
			["F", "sharp", 5],
		]);
		const key = detectKey(phrase);
		expect(key.tonic).toBe("G");
		expect(key.mode).toBe("major");
	});

	it("spells a flat key with a flat tonic, not a sharp enharmonic", () => {
		// Bb major scale (Bb C D Eb F G A) — the opening Bb anchors the tonic.
		// Regression guard: the tonic must read "Bb", never "A#".
		const phrase = makePhrase([
			["B", "flat", 3],
			["C", null, 4],
			["D", null, 4],
			["E", "flat", 4],
			["F", null, 4],
			["G", null, 4],
			["A", null, 4],
		]);
		const key = detectKey(phrase);
		expect(key.tonic).toBe("B");
		expect(key.accidental).toBe("flat");
		expect(key.mode).toBe("major");
	});

	it("returns the sounded note as tonic for a single-note phrase", () => {
		// A single E4: K-S aligns its profile peak (the tonic) to the only pitch,
		// so the tonic is E. Mode is left unconstrained (a lone note is ambiguous).
		const phrase = makePhrase([["E", null, 4]]);
		const key = detectKey(phrase);
		expect(key.tonic).toBe("E");
		expect(key.accidental).toBeNull();
		expect(["major", "minor"]).toContain(key.mode);
	});

	it("is stable across octave transpositions of the same melody", () => {
		// Same chromatic content in two different octaves — key should be the same.
		const low = makePhrase([
			["C", null, 3],
			["E", null, 3],
			["G", null, 3],
		]);
		const high = makePhrase([
			["C", null, 5],
			["E", null, 5],
			["G", null, 5],
		]);
		const keyLow = detectKey(low);
		const keyHigh = detectKey(high);
		expect(keyLow.tonic).toBe(keyHigh.tonic);
		expect(keyLow.mode).toBe(keyHigh.mode);
	});

	it("handles an empty phrase gracefully (returns a valid Key)", () => {
		const phrase: Phrase = {
			notes: [],
			timeSignatureNumerator: 4,
			timeSignatureDenominator: 4,
			bpm: 90,
		};
		const key = detectKey(phrase);
		expect(key.tonic).toMatch(/^[A-G]$/);
		expect(["major", "minor"]).toContain(key.mode);
	});
});

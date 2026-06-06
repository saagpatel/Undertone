import { describe, expect, it } from "vitest";
import type { Chord, ChordTone } from "./harmony";
import { noteFrequency } from "./quantize";
import { voiceChord } from "./voicing";

// ─── Helpers ────────────────────────────────────────────────────────────────

function ct(
	pitch: ChordTone["pitch"],
	accidental: ChordTone["accidental"] = null,
): ChordTone {
	return { pitch, accidental };
}

/** Build a minimal Chord fixture for voicing tests. */
function makeChord(
	root: ChordTone,
	tones: ChordTone[],
	quality: Chord["quality"] = "major",
): Chord {
	return {
		roman: "I",
		degree: 1,
		quality,
		root,
		tones,
		symbol: root.pitch,
		beatPosition: 0,
		beats: 4,
	};
}

// ─── A-minor: A, C, E (wrap case) ───────────────────────────────────────────

describe("voiceChord — A-minor triad (A C E) from octave 3", () => {
	const aMinor = makeChord(ct("A"), [ct("A"), ct("C"), ct("E")], "minor");
	const voiced = voiceChord(aMinor, { triadOctave: 3 });

	it("tones[0] (A) stays in octave 3", () => {
		expect(voiced.triad[0]).toEqual({
			pitch: "A",
			accidental: null,
			octave: 3,
		});
	});

	it("tones[1] (C) bumps to octave 4 because C3 < A3", () => {
		expect(voiced.triad[1]).toEqual({
			pitch: "C",
			accidental: null,
			octave: 4,
		});
	});

	it("tones[2] (E) stays in octave 4 because E4 > C4", () => {
		expect(voiced.triad[2]).toEqual({
			pitch: "E",
			accidental: null,
			octave: 4,
		});
	});

	it("triad is strictly ascending in frequency", () => {
		const freqs = voiced.triad.map((t) => noteFrequency(t));
		expect(freqs[1]).toBeGreaterThan(freqs[0]);
		expect(freqs[2]).toBeGreaterThan(freqs[1]);
	});

	it("bass defaults to bassOctave 2", () => {
		const defaultVoiced = voiceChord(aMinor);
		expect(defaultVoiced.bass.octave).toBe(2);
		expect(defaultVoiced.bass.pitch).toBe("A");
		expect(defaultVoiced.bass.accidental).toBeNull();
	});
});

// ─── C-major: C, E, G (stays in one octave) ─────────────────────────────────

describe("voiceChord — C-major triad (C E G) from octave 3", () => {
	const cMajor = makeChord(ct("C"), [ct("C"), ct("E"), ct("G")]);
	const voiced = voiceChord(cMajor, { triadOctave: 3 });

	it("all three tones stay in octave 3", () => {
		expect(voiced.triad[0].octave).toBe(3);
		expect(voiced.triad[1].octave).toBe(3);
		expect(voiced.triad[2].octave).toBe(3);
	});

	it("tones are C3, E3, G3", () => {
		expect(voiced.triad[0]).toEqual({
			pitch: "C",
			accidental: null,
			octave: 3,
		});
		expect(voiced.triad[1]).toEqual({
			pitch: "E",
			accidental: null,
			octave: 3,
		});
		expect(voiced.triad[2]).toEqual({
			pitch: "G",
			accidental: null,
			octave: 3,
		});
	});

	it("bass is one octave below the triad root (C2)", () => {
		expect(voiced.bass).toEqual({ pitch: "C", accidental: null, octave: 2 });
	});
});

// ─── Default octaves ─────────────────────────────────────────────────────────

describe("voiceChord — default octaves (no opts)", () => {
	const gMajor = makeChord(ct("G"), [ct("G"), ct("B"), ct("D")]);
	const voiced = voiceChord(gMajor);

	it("triad root is at octave 3", () => {
		expect(voiced.triad[0].octave).toBe(3);
	});

	it("bass is at octave 2", () => {
		expect(voiced.bass.octave).toBe(2);
		expect(voiced.bass.pitch).toBe("G");
	});

	it("G B D from octave 3 wraps D to octave 4 (D < G in same octave)", () => {
		// G3 (semitone 7), B3 (semitone 11), D3 (semitone 2) < B3 → bump to D4
		expect(voiced.triad[2]).toEqual({
			pitch: "D",
			accidental: null,
			octave: 4,
		});
	});
});

// ─── Custom bassOctave ────────────────────────────────────────────────────────

describe("voiceChord — custom opts", () => {
	const fMajor = makeChord(ct("F"), [ct("F"), ct("A"), ct("C")]);

	it("respects explicit bassOctave", () => {
		const voiced = voiceChord(fMajor, { bassOctave: 1 });
		expect(voiced.bass.octave).toBe(1);
	});

	it("respects explicit triadOctave", () => {
		const voiced = voiceChord(fMajor, { triadOctave: 4 });
		expect(voiced.triad[0].octave).toBe(4);
	});
});

// ─── Determinism ─────────────────────────────────────────────────────────────

describe("voiceChord — determinism", () => {
	const eMinor = makeChord(ct("E"), [ct("E"), ct("G"), ct("B")], "minor");

	it("returns the same result on repeated calls", () => {
		const a = voiceChord(eMinor, { triadOctave: 3 });
		const b = voiceChord(eMinor, { triadOctave: 3 });
		expect(a).toEqual(b);
	});

	it("does not mutate the input chord", () => {
		const chord = makeChord(ct("E"), [ct("E"), ct("G"), ct("B")], "minor");
		const tonesBefore = JSON.stringify(chord.tones);
		voiceChord(chord);
		expect(JSON.stringify(chord.tones)).toBe(tonesBefore);
	});
});

// ─── Sharp/flat accidentals ───────────────────────────────────────────────────

describe("voiceChord — accidentals preserved", () => {
	// B-flat major: Bb D F
	const bbMajor = makeChord(ct("B", "flat"), [
		ct("B", "flat"),
		ct("D"),
		ct("F"),
	]);
	const voiced = voiceChord(bbMajor, { triadOctave: 3 });

	it("root carries flat accidental", () => {
		expect(voiced.triad[0].accidental).toBe("flat");
	});

	it("triad is ascending in frequency", () => {
		const freqs = voiced.triad.map((t) => noteFrequency(t));
		expect(freqs[1]).toBeGreaterThan(freqs[0]);
		expect(freqs[2]).toBeGreaterThan(freqs[1]);
	});
});

import { describe, expect, it } from "vitest";
import { fixturePhrase } from "../../tests/fixtures/fixture-phrase";
import type { Chord } from "./harmony";
import {
	buildAccompanimentSchedule,
	buildSchedule,
	scheduleDuration,
} from "./playback";
import { noteFrequency, type Phrase } from "./quantize";

describe("noteFrequency (inverse of frequencyToPitch)", () => {
	it("maps A4 to exactly 440 Hz", () => {
		expect(noteFrequency({ pitch: "A", accidental: null, octave: 4 })).toBe(
			440,
		);
	});

	it("maps middle C (C4) to ~261.63 Hz", () => {
		expect(
			noteFrequency({ pitch: "C", accidental: null, octave: 4 }),
		).toBeCloseTo(261.63, 1);
	});

	it("raises a sharp and lowers a flat by one semitone", () => {
		const cSharp = noteFrequency({
			pitch: "C",
			accidental: "sharp",
			octave: 4,
		});
		const dFlat = noteFrequency({ pitch: "D", accidental: "flat", octave: 4 });
		// C#4 and Db4 are enharmonic — identical pitch.
		expect(cSharp).toBeCloseTo(dFlat, 5);
		expect(cSharp).toBeCloseTo(277.18, 1);
	});

	it("doubles frequency per octave", () => {
		const a4 = noteFrequency({ pitch: "A", accidental: null, octave: 4 });
		const a5 = noteFrequency({ pitch: "A", accidental: null, octave: 5 });
		expect(a5).toBeCloseTo(a4 * 2, 5);
	});
});

describe("buildSchedule", () => {
	const schedule = buildSchedule(fixturePhrase); // C4 q, E4 q, G4 h @ 90 BPM

	it("emits one entry per note", () => {
		expect(schedule).toHaveLength(3);
	});

	it("times a quarter note at 90 BPM as ~667 ms", () => {
		expect(schedule[0].durationSec).toBeCloseTo(0.667, 2);
	});

	it("times a half note at 90 BPM as ~1333 ms", () => {
		expect(schedule[2].durationSec).toBeCloseTo(1.333, 2);
	});

	it("derives every start from the beat grid (no drift)", () => {
		const secondsPerBeat = 60 / 90;
		expect(schedule.map((n) => n.startSec)).toEqual([
			0,
			1 * secondsPerBeat,
			2 * secondsPerBeat,
		]);
	});

	it("carries the correct pitch frequencies", () => {
		expect(schedule[0].frequency).toBeCloseTo(261.63, 1); // C4
		expect(schedule[1].frequency).toBeCloseTo(329.63, 1); // E4
		expect(schedule[2].frequency).toBeCloseTo(392.0, 1); // G4
	});

	it("returns an empty schedule for an empty phrase", () => {
		const empty: Phrase = {
			notes: [],
			timeSignatureNumerator: 4,
			timeSignatureDenominator: 4,
			bpm: 90,
		};
		expect(buildSchedule(empty)).toEqual([]);
	});
});

describe("scheduleDuration", () => {
	it("ends at the last note's tail", () => {
		// G4 half note starts at beat 2 (1.333s) and lasts 1.333s → ends ~2.667s.
		expect(scheduleDuration(buildSchedule(fixturePhrase))).toBeCloseTo(
			2.667,
			2,
		);
	});

	it("is zero for an empty schedule", () => {
		expect(scheduleDuration([])).toBe(0);
	});
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Minimal Chord fixture: C-major, beats 0–4 at 120 BPM. */
function makeCMajorChord(beatPosition = 0, beats = 4): Chord {
	return {
		roman: "I",
		degree: 1,
		quality: "major",
		root: { pitch: "C", accidental: null },
		tones: [
			{ pitch: "C", accidental: null },
			{ pitch: "E", accidental: null },
			{ pitch: "G", accidental: null },
		],
		symbol: "C",
		beatPosition,
		beats,
	};
}

/** A-minor chord, beats 4–8. */
function makeAMinorChord(beatPosition = 4, beats = 4): Chord {
	return {
		roman: "vi",
		degree: 6,
		quality: "minor",
		root: { pitch: "A", accidental: null },
		tones: [
			{ pitch: "A", accidental: null },
			{ pitch: "C", accidental: null },
			{ pitch: "E", accidental: null },
		],
		symbol: "Am",
		beatPosition,
		beats,
	};
}

// ─── buildAccompanimentSchedule ───────────────────────────────────────────────

describe("buildAccompanimentSchedule — empty input", () => {
	it("returns an empty array for no chords", () => {
		expect(buildAccompanimentSchedule([], 120)).toEqual([]);
	});
});

describe("buildAccompanimentSchedule — single C-major chord @ 120 BPM", () => {
	const BPM = 120;
	const chord = makeCMajorChord(0, 4);
	const schedule = buildAccompanimentSchedule([chord], BPM);

	it("emits exactly 4 entries (bass + 3 triad tones)", () => {
		expect(schedule).toHaveLength(4);
	});

	it("all notes share the chord's startSec (beat 0 → 0 s)", () => {
		for (const note of schedule) {
			expect(note.startSec).toBeCloseTo(0, 6);
		}
	});

	it("all notes share the chord's durationSec (4 beats @ 120 BPM → 2 s)", () => {
		const expected = 4 * (60 / BPM); // 2.0 s
		for (const note of schedule) {
			expect(note.durationSec).toBeCloseTo(expected, 5);
		}
	});

	it("bass note (C2) is one octave below the triad root (C3)", () => {
		const bassFreq = noteFrequency({ pitch: "C", accidental: null, octave: 2 });
		const rootFreq = noteFrequency({ pitch: "C", accidental: null, octave: 3 });
		// First entry is the bass.
		expect(schedule[0].frequency).toBeCloseTo(bassFreq, 4);
		// Second entry is the triad root (C3).
		expect(schedule[1].frequency).toBeCloseTo(rootFreq, 4);
		// Bass is exactly one octave below triad root.
		expect(schedule[1].frequency).toBeCloseTo(schedule[0].frequency * 2, 4);
	});

	it("triad entries are in ascending frequency (C3 < E3 < G3)", () => {
		// entries 1,2,3 are the triad tones
		expect(schedule[2].frequency).toBeGreaterThan(schedule[1].frequency);
		expect(schedule[3].frequency).toBeGreaterThan(schedule[2].frequency);
	});
});

describe("buildAccompanimentSchedule — two chords", () => {
	const BPM = 90;
	const spb = 60 / BPM; // seconds per beat
	const chords = [makeCMajorChord(0, 4), makeAMinorChord(4, 4)];
	const schedule = buildAccompanimentSchedule(chords, BPM);

	it("count === chords.length * 4", () => {
		expect(schedule).toHaveLength(chords.length * 4);
	});

	it("second chord entries start at beat 4 in seconds", () => {
		const expectedStart = 4 * spb;
		for (const note of schedule.slice(4)) {
			expect(note.startSec).toBeCloseTo(expectedStart, 5);
		}
	});

	it("uses the same 60/bpm beat math as buildSchedule (shared time base)", () => {
		// buildSchedule on a note at beat 4 also yields startSec = 4 * (60/bpm)
		const melodyNote: import("./quantize").NoteEvent = {
			pitch: "A",
			accidental: null,
			octave: 4,
			noteValue: "quarter",
			beatPosition: 4,
		};
		const melodySchedule = buildSchedule({
			notes: [melodyNote],
			bpm: BPM,
			timeSignatureNumerator: 4,
			timeSignatureDenominator: 4,
		});
		expect(melodySchedule[0].startSec).toBeCloseTo(schedule[4].startSec, 5);
	});

	it("each chord has the correct durationSec (4 beats @ 90 BPM)", () => {
		const expectedDur = 4 * spb;
		for (const note of schedule) {
			expect(note.durationSec).toBeCloseTo(expectedDur, 5);
		}
	});
});

describe("buildAccompanimentSchedule — style variants", () => {
	const BPM = 120;
	const spb = 60 / BPM; // 0.5 s/beat
	const chord = makeCMajorChord(0, 4);

	it("explicit block style is identical to the default", () => {
		expect(buildAccompanimentSchedule([chord], BPM, "block")).toEqual(
			buildAccompanimentSchedule([chord], BPM),
		);
	});

	it("arpeggio spreads the four voices across ascending onsets", () => {
		const schedule = buildAccompanimentSchedule([chord], BPM, "arpeggio");
		expect(schedule).toHaveLength(4);
		// One voice per beat of the 4-beat slot, each a single beat long.
		expect(schedule.map((n) => n.startSec)).toEqual([
			0 * spb,
			1 * spb,
			2 * spb,
			3 * spb,
		]);
		for (const note of schedule) {
			expect(note.durationSec).toBeCloseTo(spb, 6);
		}
		// Pitch rises monotonically across the run.
		for (let i = 1; i < schedule.length; i++) {
			expect(schedule[i].frequency).toBeGreaterThan(schedule[i - 1].frequency);
		}
	});

	it("alberti plays the low-high-mid-high cycle", () => {
		const schedule = buildAccompanimentSchedule([chord], BPM, "alberti");
		expect(schedule.map((n) => n.startSec)).toEqual([
			0 * spb,
			1 * spb,
			2 * spb,
			3 * spb,
		]);
		const [low, high1, mid, high2] = schedule.map((n) => n.frequency);
		expect(low).toBeLessThan(mid); // bass below the inner voice
		expect(high1).toBeGreaterThan(mid); // fifth above the third
		expect(high2).toBeCloseTo(high1, 6); // steps 2 and 4 are the same voice
	});

	it("onsets stay on the shared 60/bpm time base", () => {
		const arp = buildAccompanimentSchedule([chord], BPM, "arpeggio");
		// Third voice lands at beat 2 — same math buildSchedule would use.
		expect(arp[2].startSec).toBeCloseTo(2 * spb, 6);
	});
});

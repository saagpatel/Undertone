import { describe, expect, it } from "vitest";
import { fixturePhrase } from "../../tests/fixtures/fixture-phrase";
import { buildSchedule, scheduleDuration } from "./playback";
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

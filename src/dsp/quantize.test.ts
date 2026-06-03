import { describe, expect, it } from "vitest";
import type { RawPhrase } from "./capture";
import {
	durationToNoteValue,
	frequencyToPitch,
	quantizePhrase,
} from "./quantize";

describe("frequencyToPitch", () => {
	it("maps A4 = 440 Hz to A4 natural", () => {
		expect(frequencyToPitch(440)).toEqual({
			pitch: "A",
			accidental: null,
			octave: 4,
		});
	});

	it("maps C5 = 523.25 Hz to C5 natural", () => {
		expect(frequencyToPitch(523.25)).toEqual({
			pitch: "C",
			accidental: null,
			octave: 5,
		});
	});

	it("maps middle C = 261.63 Hz to C4 natural", () => {
		expect(frequencyToPitch(261.63)).toEqual({
			pitch: "C",
			accidental: null,
			octave: 4,
		});
	});

	it("maps F#4 = 369.99 Hz to F sharp, octave 4", () => {
		expect(frequencyToPitch(369.99)).toEqual({
			pitch: "F",
			accidental: "sharp",
			octave: 4,
		});
	});
});

describe("durationToNoteValue at 90 BPM", () => {
	it("667 ms is a quarter note", () => {
		expect(durationToNoteValue(667, 90)).toBe("quarter");
	});

	it("400 ms is an eighth note (not a quarter)", () => {
		expect(durationToNoteValue(400, 90)).toBe("eighth");
	});

	it("333 ms is an eighth note", () => {
		expect(durationToNoteValue(333, 90)).toBe("eighth");
	});

	it("160 ms is a sixteenth note", () => {
		expect(durationToNoteValue(160, 90)).toBe("sixteenth");
	});

	it("1333 ms is a half note", () => {
		expect(durationToNoteValue(1333, 90)).toBe("half");
	});

	it("2667 ms is a whole note", () => {
		expect(durationToNoteValue(2667, 90)).toBe("whole");
	});
});

describe("quantizePhrase", () => {
	it("quantizes a single A4 quarter note at beat 0", () => {
		const raw: RawPhrase = [{ frequency: 440, onsetMs: 0, durationMs: 667 }];
		const phrase = quantizePhrase(raw, { bpm: 90 });
		expect(phrase.notes[0]).toEqual({
			pitch: "A",
			accidental: null,
			octave: 4,
			noteValue: "quarter",
			beatPosition: 0,
		});
		expect(phrase.bpm).toBe(90);
		expect(phrase.timeSignatureNumerator).toBe(4);
		expect(phrase.timeSignatureDenominator).toBe(4);
	});

	it("returns an empty phrase for an empty RawPhrase", () => {
		expect(quantizePhrase([]).notes).toEqual([]);
	});

	it("snaps on-grid onsets to 16th-note beat positions", () => {
		const raw: RawPhrase = [
			{ frequency: 440, onsetMs: 0, durationMs: 667 }, // beat 0
			{ frequency: 440, onsetMs: 666.67, durationMs: 667 }, // beat 1
		];
		const phrase = quantizePhrase(raw, { bpm: 90 });
		expect(phrase.notes.map((n) => n.beatPosition)).toEqual([0, 1]);
	});

	it("falls back to sequential placement when most onsets miss the grid", () => {
		const raw: RawPhrase = [
			{ frequency: 440, onsetMs: 0, durationMs: 667 }, // quarter
			{ frequency: 494, onsetMs: 900, durationMs: 333 }, // eighth, off-grid onset
			{ frequency: 523, onsetMs: 1730, durationMs: 333 }, // eighth, off-grid onset
		];
		const phrase = quantizePhrase(raw, { bpm: 90 });
		expect(phrase.notes.map((n) => n.beatPosition)).toEqual([0, 1, 1.5]);
	});
});

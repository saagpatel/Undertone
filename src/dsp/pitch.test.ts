import { describe, expect, it } from "vitest";
import { silence } from "../../tests/fixtures/silence";
import {
	FRAME_SIZE,
	makeSine,
	SAMPLE_RATE,
	sineA4,
} from "../../tests/fixtures/sine-a4";
import { detectPitch, RMS_SILENCE_FLOOR } from "./pitch";

describe("detectPitch", () => {
	it("detects a 440 Hz (A4) sine within ±5 Hz with high confidence", () => {
		const r = detectPitch(sineA4, SAMPLE_RATE);
		expect(r.frequency).toBeGreaterThan(435);
		expect(r.frequency).toBeLessThan(445);
		expect(r.confidence).toBeGreaterThanOrEqual(0.9);
		expect(r.rms).toBeGreaterThan(RMS_SILENCE_FLOOR);
	});

	it("reports silence as frequency 0 with rms below the floor", () => {
		const r = detectPitch(silence, SAMPLE_RATE);
		expect(r.frequency).toBe(0);
		expect(r.rms).toBeLessThan(RMS_SILENCE_FLOOR);
	});

	it("detects C4 (~261.6 Hz) within ±5 Hz", () => {
		const c4 = makeSine(261.63, SAMPLE_RATE, FRAME_SIZE);
		const r = detectPitch(c4, SAMPLE_RATE);
		expect(r.frequency).toBeGreaterThan(256.63);
		expect(r.frequency).toBeLessThan(266.63);
	});

	it("detects A5 (880 Hz) without dropping an octave", () => {
		const a5 = makeSine(880, SAMPLE_RATE, FRAME_SIZE);
		const r = detectPitch(a5, SAMPLE_RATE);
		expect(r.frequency).toBeGreaterThan(875);
		expect(r.frequency).toBeLessThan(885);
	});

	it("detects a quiet but audible tone (amplitude 0.2)", () => {
		const quiet = makeSine(440, SAMPLE_RATE, FRAME_SIZE, 0.2);
		const r = detectPitch(quiet, SAMPLE_RATE);
		expect(r.frequency).toBeGreaterThan(435);
		expect(r.frequency).toBeLessThan(445);
		expect(r.rms).toBeGreaterThan(RMS_SILENCE_FLOOR);
	});
});

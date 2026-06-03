import { describe, expect, it } from "vitest";
import { CaptureSession, reduceFramesToPhrase } from "./capture";
import type { PitchResult } from "./pitch";

function frame(
	frequency: number,
	timestamp: number,
	voiced = true,
): PitchResult {
	return voiced
		? { frequency, confidence: 0.99, rms: 0.1, timestamp }
		: { frequency: 0, confidence: 0, rms: 0, timestamp };
}

/** A run of `count` frames at `dtMs` spacing, voiced or silent. */
function run(
	frequency: number,
	startMs: number,
	count: number,
	dtMs: number,
	voiced = true,
): PitchResult[] {
	return Array.from({ length: count }, (_, i) =>
		frame(frequency, startMs + i * dtMs, voiced),
	);
}

// A4 for 400 ms, silence for 200 ms, C5 for 600 ms (40 ms frame spacing).
const huMSilenceHum: PitchResult[] = [
	...run(440, 0, 10, 40),
	...run(0, 400, 5, 40, false),
	...run(523.25, 600, 15, 40),
];

describe("reduceFramesToPhrase", () => {
	it("splits a hum / silence / hum sequence into two notes", () => {
		const phrase = reduceFramesToPhrase(huMSilenceHum);
		expect(phrase).toHaveLength(2);
		expect(phrase[0].frequency).toBeCloseTo(440, 0);
		expect(phrase[1].frequency).toBeCloseTo(523.25, 0);
		expect(phrase[0].onsetMs).toBe(0);
	});

	it("returns an empty phrase for silence only", () => {
		expect(reduceFramesToPhrase(run(0, 0, 30, 40, false))).toEqual([]);
	});

	it("ignores a blip shorter than the onset window", () => {
		const blip = [
			...run(0, 0, 3, 40, false),
			...run(440, 120, 2, 40), // only 2 voiced frames — below ONSET_FRAMES
			...run(0, 200, 6, 40, false),
		];
		expect(reduceFramesToPhrase(blip)).toEqual([]);
	});

	it("splits a legato pitch jump with no intervening silence", () => {
		const legato = [...run(440, 0, 10, 40), ...run(523.25, 400, 10, 40)];
		const phrase = reduceFramesToPhrase(legato);
		expect(phrase).toHaveLength(2);
		expect(phrase[0].frequency).toBeCloseTo(440, 0);
		expect(phrase[1].frequency).toBeCloseTo(523.25, 0);
	});
});

describe("CaptureSession", () => {
	it("buffers pushed frames and folds to the same phrase on finish", () => {
		const session = new CaptureSession();
		huMSilenceHum.forEach((f) => session.push(f));
		expect(session.isCapturing).toBe(true);
		const phrase = session.finish();
		expect(phrase).toHaveLength(2);
		expect(session.isCapturing).toBe(false);
	});

	it("auto-terminates once a frame arrives past the session timeout", () => {
		const session = new CaptureSession();
		session.push(frame(440, 0));
		session.push(frame(440, 40));
		session.push(frame(440, 9000)); // > SESSION_TIMEOUT_MS after start
		expect(session.isCapturing).toBe(false);
	});
});

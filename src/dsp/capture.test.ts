import { describe, expect, it } from "vitest";
import {
	HUMMING_SAMPLE_RATE,
	makeHummingFrame,
	silentHummingFrame,
} from "../../tests/fixtures/humming";
import { adverseFrames } from "../../tests/fixtures/rehearsal";
import {
	CaptureSession,
	captureEvidenceFromFrames,
	reduceFramesToPhrase,
} from "./capture";
import type { PitchResult } from "./pitch";
import { detectPitch } from "./pitch";

function frame(
	frequency: number,
	timestamp: number,
	voiced = true,
): PitchResult {
	return voiced
		? { frequency, confidence: 0.99, rms: 0.1, peak: 0.2, timestamp }
		: { frequency: 0, confidence: 0, rms: 0, peak: 0, timestamp };
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

	it("keeps a gradual portamento inside one note", () => {
		const portamento = Array.from({ length: 14 }, (_, index) =>
			frame(440 * 2 ** ((index * 8) / 1_200), index * 40),
		);
		const phrase = reduceFramesToPhrase(portamento);
		expect(phrase).toHaveLength(1);
		expect(phrase[0].frequency).toBeGreaterThan(450);
		expect(phrase[0].frequency).toBeLessThan(470);
	});
});

describe("CaptureSession", () => {
	it("buffers pushed frames and folds to the same phrase on finish", () => {
		const session = new CaptureSession();
		huMSilenceHum.forEach((frame) => {
			session.push(frame);
		});
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

	it("finishes with raw timing and a session-only quality summary", () => {
		const session = new CaptureSession();
		huMSilenceHum.forEach((reading) => {
			session.push(reading);
		});
		const evidence = session.finishEvidence();
		expect(evidence.rawPhrase).toHaveLength(2);
		expect(evidence.quality.totalFrames).toBe(30);
		expect(evidence.quality.voicedFrames).toBe(25);
		expect(evidence.quality.unvoicedFrames).toBe(5);
		expect(evidence.quality.medianFrameIntervalMs).toBe(40);
		expect(evidence.quality.onsetUncertaintyMs).toBeGreaterThanOrEqual(120);
	});
});

describe("captureEvidenceFromFrames", () => {
	it("distinguishes silence, energetic noise, low confidence, clipping, and range", () => {
		const frames = [
			{ ...adverseFrames.silence, timestamp: 0 },
			{ ...adverseFrames.backgroundNoise, timestamp: 20 },
			{ ...adverseFrames.lowConfidence, timestamp: 40 },
			{ ...adverseFrames.clipped, timestamp: 60 },
			{ ...adverseFrames.outOfRange, timestamp: 80 },
		];
		const { quality } = captureEvidenceFromFrames(frames);
		expect(quality.unvoicedFrames).toBe(1);
		expect(quality.noiseFrames).toBe(1);
		expect(quality.lowConfidenceFrames).toBe(1);
		expect(quality.clippedFrames).toBe(1);
		expect(quality.outOfRangeFrames).toBe(1);
		expect(quality.issues).toEqual([
			"insufficient-audio",
			"background-noise",
			"low-confidence",
			"clipping",
			"out-of-range",
		]);
	});

	it("reduces a humming-like phrase without inventing notes in quiet gaps", () => {
		const frequencies = [440, 493.88, 523.25, 587.33];
		const frames: PitchResult[] = [];
		let timestamp = 0;
		for (const [noteIndex, frequency] of frequencies.entries()) {
			for (let index = 0; index < 8; index += 1) {
				frames.push({
					...detectPitch(
						makeHummingFrame({
							frequency,
							startSeconds: timestamp / 1_000,
							seed: 0x510000 + noteIndex * 100 + index,
						}),
						HUMMING_SAMPLE_RATE,
					),
					timestamp,
				});
				timestamp += 40;
			}
			for (let index = 0; index < 4; index += 1) {
				frames.push({
					...detectPitch(silentHummingFrame(), HUMMING_SAMPLE_RATE),
					timestamp,
				});
				timestamp += 40;
			}
		}

		const evidence = captureEvidenceFromFrames(frames);
		expect(evidence.rawPhrase).toHaveLength(4);
		expect(evidence.rawPhrase[0].frequency).toBeGreaterThan(430);
		expect(evidence.rawPhrase[0].frequency).toBeLessThan(450);
		expect(evidence.quality.voicedFrames).toBeGreaterThanOrEqual(28);
		expect(evidence.quality.noiseFrames).toBe(0);
	});
});

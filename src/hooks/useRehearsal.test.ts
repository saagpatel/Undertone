import { describe, expect, it } from "vitest";
import { cleanBaseline, transposedUpTwo } from "../../tests/fixtures/rehearsal";
import type { CaptureQualitySummary, RawPhrase } from "../dsp/capture";
import { quantizePhrase } from "../dsp/quantize";
import { estimateTempo, type MelodyTake } from "../dsp/rehearsal";
import { EMPTY_REHEARSAL, rehearsalReducer } from "./useRehearsal";

const cleanQuality: CaptureQualitySummary = {
	totalFrames: 100,
	voicedFrames: 80,
	unvoicedFrames: 20,
	noiseFrames: 0,
	lowConfidenceFrames: 0,
	clippedFrames: 0,
	outOfRangeFrames: 0,
	medianConfidence: 0.98,
	medianFrameIntervalMs: 16,
	frameIntervalJitterMs: 1,
	onsetUncertaintyMs: 49,
	durationMs: 2100,
	issues: [],
};

function take(id: number, rawPhrase: RawPhrase): MelodyTake {
	const tempo = estimateTempo(rawPhrase);
	return {
		id,
		source: "microphone",
		phrase: quantizePhrase(rawPhrase, { bpm: tempo.bpm }),
		evidence: { rawPhrase, quality: cleanQuality },
		tempo,
		processingLatencyMs: 1,
	};
}

describe("rehearsalReducer", () => {
	it("holds an immutable baseline and compares the next take", () => {
		const baseline = take(1, cleanBaseline);
		const repeat = take(2, transposedUpTwo);
		const started = rehearsalReducer(EMPTY_REHEARSAL, {
			type: "set-baseline",
			take: baseline,
		});
		const compared = rehearsalReducer(started, {
			type: "accept-repeat",
			take: repeat,
		});
		expect(compared.baseline).toBe(baseline);
		expect(compared.repeat).toBe(repeat);
		expect(compared.comparison?.pitch?.globalTranspositionSemitones).toBe(2);
	});

	it("updates the repeat while retaining the original baseline", () => {
		const baseline = take(1, cleanBaseline);
		const firstRepeat = take(2, transposedUpTwo);
		const secondRepeat = take(3, cleanBaseline);
		const started = rehearsalReducer(EMPTY_REHEARSAL, {
			type: "set-baseline",
			take: baseline,
		});
		const compared = rehearsalReducer(started, {
			type: "accept-repeat",
			take: firstRepeat,
		});
		const updated = rehearsalReducer(compared, {
			type: "accept-repeat",
			take: secondRepeat,
		});
		expect(updated.baseline).toBe(baseline);
		expect(updated.repeat).toBe(secondRepeat);
		expect(updated.comparison?.pitch?.meanAbsoluteLocalErrorCents).toBeLessThan(
			0.01,
		);
	});

	it("ignores duplicate capture ids and resets only the session", () => {
		const baseline = take(1, cleanBaseline);
		const started = rehearsalReducer(EMPTY_REHEARSAL, {
			type: "set-baseline",
			take: baseline,
		});
		expect(
			rehearsalReducer(started, { type: "accept-repeat", take: baseline }),
		).toBe(started);
		expect(rehearsalReducer(started, { type: "reset" })).toEqual(
			EMPTY_REHEARSAL,
		);
	});
});

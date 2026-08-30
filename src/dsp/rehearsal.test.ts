import { describe, expect, it } from "vitest";
import {
	HUMMING_SAMPLE_RATE,
	makeHummingFrame,
	silentHummingFrame,
} from "../../tests/fixtures/humming";
import {
	cleanBaseline,
	extraPassingNote,
	fasterSameContour,
	fewerNotes,
	octaveShift,
	oneOctaveError,
	timingDrift,
	transposedUpTwo,
	transposedWithLocalDrift,
} from "../../tests/fixtures/rehearsal";
import {
	type CaptureQualitySummary,
	captureEvidenceFromFrames,
	type RawPhrase,
} from "./capture";
import { detectPitch, type PitchResult } from "./pitch";
import { quantizePhrase } from "./quantize";
import {
	compareTakes,
	createMelodyTake,
	estimateTempo,
	type MelodyTake,
} from "./rehearsal";

function quality(
	overrides: Partial<CaptureQualitySummary> = {},
): CaptureQualitySummary {
	return {
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
		...overrides,
	};
}

function take(
	id: number,
	rawPhrase: RawPhrase,
	qualityOverrides: Partial<CaptureQualitySummary> = {},
): MelodyTake {
	const tempo = estimateTempo(rawPhrase);
	return {
		id,
		source: "microphone",
		phrase: quantizePhrase(rawPhrase, { bpm: tempo.bpm }),
		evidence: { rawPhrase, quality: quality(qualityOverrides) },
		tempo,
		processingLatencyMs: 1.5,
	};
}

function hummingEvidence(
	frequencies: readonly number[],
	localCents: readonly number[] = frequencies.map(() => 0),
) {
	const frames: PitchResult[] = [];
	let timestamp = 0;
	for (const [noteIndex, frequency] of frequencies.entries()) {
		for (let index = 0; index < 8; index += 1) {
			frames.push({
				...detectPitch(
					makeHummingFrame({
						frequency: frequency * 2 ** (localCents[noteIndex] / 1_200),
						startSeconds: timestamp / 1_000,
						seed: 0x520000 + noteIndex * 100 + index,
					}),
					HUMMING_SAMPLE_RATE,
				),
				timestamp,
			});
			timestamp += 40;
		}
		if (noteIndex < frequencies.length - 1) {
			for (let index = 0; index < 3; index += 1) {
				frames.push({
					...detectPitch(silentHummingFrame(), HUMMING_SAMPLE_RATE),
					timestamp,
				});
				timestamp += 40;
			}
		}
	}
	return captureEvidenceFromFrames(frames);
}

describe("estimateTempo", () => {
	it("infers a 120 BPM pulse from stable 500 ms onsets", () => {
		const estimate = estimateTempo(cleanBaseline);
		expect(estimate.bpm).toBe(120);
		expect(estimate.confidence).toBeGreaterThanOrEqual(0.7);
		expect(estimate.uncertaintyBpm).toBe(0);
	});

	it("keeps sparse evidence explicitly uncertain", () => {
		const estimate = estimateTempo(cleanBaseline.slice(0, 1));
		expect(estimate.bpm).toBe(90);
		expect(estimate.confidence).toBe(0);
		expect(estimate.uncertaintyBpm).toBeNull();
	});
});

describe("createMelodyTake", () => {
	it("keeps inferred tempo out of existing composition quantization", () => {
		const mixedRhythm: RawPhrase = [
			{ frequency: 440, onsetMs: 0, durationMs: 180 },
			{ frequency: 493.88, onsetMs: 250, durationMs: 400 },
			{ frequency: 523.25, onsetMs: 750, durationMs: 650 },
			{ frequency: 587.33, onsetMs: 1500, durationMs: 300 },
		];
		const evidence = { rawPhrase: mixedRhythm, quality: quality() };
		const created = createMelodyTake(9, evidence, 2.5);
		expect(created.tempo.bpm).not.toBe(90);
		expect(created.phrase).toEqual(quantizePhrase(mixedRhythm));
		expect(created.phrase).not.toEqual(
			quantizePhrase(mixedRhythm, { bpm: created.tempo.bpm }),
		);
	});
});

describe("compareTakes", () => {
	it("separates a global two-semitone transposition from local drift", () => {
		const comparison = compareTakes(
			take(1, cleanBaseline),
			take(2, transposedUpTwo),
		);
		expect(comparison.status).toBe("ready");
		expect(comparison.pitch?.globalTranspositionSemitones).toBe(2);
		expect(comparison.pitch?.meanAbsoluteLocalErrorCents).toBeLessThan(0.01);
		expect(comparison.issues).not.toContain("unvoiced-sections");
	});

	it("reports residual drift after removing the global shift", () => {
		const comparison = compareTakes(
			take(1, cleanBaseline),
			take(2, transposedWithLocalDrift),
		);
		expect(comparison.pitch?.globalTranspositionSemitones).toBe(2);
		expect(comparison.pitch?.meanAbsoluteLocalErrorCents).toBeGreaterThan(15);
		expect(comparison.pitch?.meanAbsoluteLocalErrorCents).toBeLessThan(40);
		expect(comparison.pitch?.maxAbsoluteLocalErrorCents).toBeGreaterThan(25);
	});

	it("preserves global shift versus local drift through humming-like detection", () => {
		const frequencies = [440, 493.88, 523.25, 587.33];
		const baseline = createMelodyTake(1, hummingEvidence(frequencies), 2);
		const repeat = createMelodyTake(
			2,
			hummingEvidence(frequencies, [185, 215, 172, 222]),
			2,
		);
		const comparison = compareTakes(baseline, repeat);

		expect(comparison.pitch?.globalTranspositionSemitones).toBe(2);
		expect(comparison.pitch?.meanAbsoluteLocalErrorCents).toBeGreaterThan(10);
		expect(comparison.pitch?.meanAbsoluteLocalErrorCents).toBeLessThan(35);
		expect(comparison.pitch?.maxAbsoluteLocalErrorCents).toBeLessThan(50);
	});

	it("does not grant perfect alignment confidence to an unrelated equal-length contour", () => {
		const unrelatedContour = cleanBaseline.map((note, index) => ({
			...note,
			frequency: [440, 659.25, 329.63, 880][index],
		}));
		const comparison = compareTakes(
			take(1, cleanBaseline),
			take(2, unrelatedContour),
		);
		expect(comparison.alignmentConfidence).toBeLessThan(0.65);
		expect(comparison.status).toBe("limited");
	});

	it("reports a tempo change without turning it into pitch drift", () => {
		const comparison = compareTakes(
			take(1, cleanBaseline),
			take(2, fasterSameContour),
		);
		expect(comparison.pitch?.meanAbsoluteLocalErrorCents).toBeLessThan(0.01);
		expect(comparison.timing?.tempoRatio).toBeGreaterThan(1.2);
		expect(comparison.timing?.tempoRatio).toBeLessThan(1.3);
		expect(comparison.timing?.meanAbsoluteOnsetErrorMs).toBeLessThan(0.01);
	});

	it("keeps local onset drift separate from the inferred tempo fit", () => {
		const comparison = compareTakes(
			take(1, cleanBaseline),
			take(2, timingDrift),
		);
		expect(comparison.timing?.medianAbsoluteOnsetErrorMs).toBeGreaterThan(10);
		expect(comparison.pitch?.meanAbsoluteLocalErrorCents).toBeLessThan(0.01);
	});

	it("flags a local octave mismatch without calling it detector certainty", () => {
		const comparison = compareTakes(
			take(1, cleanBaseline),
			take(2, oneOctaveError),
		);
		expect(comparison.issues).toContain("octave-mismatch");
		expect(
			comparison.pitch?.notes.some((note) => note.possibleOctaveMismatch),
		).toBe(true);
	});

	it("flags a whole-take octave shift as a possible octave choice", () => {
		const comparison = compareTakes(
			take(1, cleanBaseline),
			take(2, octaveShift),
		);
		expect(comparison.pitch?.globalTranspositionSemitones).toBe(12);
		expect(comparison.issues).toContain("possible-octave-shift");
	});

	it("fails closed when too few notes can be aligned", () => {
		const comparison = compareTakes(
			take(1, cleanBaseline),
			take(2, fewerNotes),
		);
		expect(comparison.status).toBe("blocked");
		expect(comparison.matchedNotes).toBeLessThan(3);
		expect(comparison.issues).toContain("different-note-count");
	});

	it("aligns one extra passing note but keeps the result uncertainty-limited", () => {
		const comparison = compareTakes(
			take(1, cleanBaseline),
			take(2, extraPassingNote),
		);
		expect(comparison.status).toBe("limited");
		expect(comparison.matchedNotes).toBe(4);
		expect(comparison.unmatchedBaselineNotes).toBe(0);
		expect(comparison.unmatchedRepeatNotes).toBe(1);
		expect(comparison.alignmentConfidence).toBeGreaterThan(0.45);
		expect(comparison.alignmentConfidence).toBeLessThan(0.8);
		expect(comparison.pitch?.globalShiftCents).toBeGreaterThan(-10);
		expect(comparison.pitch?.globalShiftCents).toBeLessThan(10);
		expect(comparison.pitch?.meanAbsoluteLocalErrorCents).toBeLessThan(10);
		expect(comparison.issues).toContain("different-note-count");
	});

	it("blocks a larger count mismatch even when three notes could be paired", () => {
		const repeatWithThreeExtras: RawPhrase = [
			...extraPassingNote,
			{ frequency: 600, onsetMs: 1720, durationMs: 100 },
			{ frequency: 620, onsetMs: 1900, durationMs: 100 },
		];
		const comparison = compareTakes(
			take(1, cleanBaseline),
			take(2, repeatWithThreeExtras),
		);
		expect(comparison.matchedNotes).toBeGreaterThanOrEqual(3);
		expect(comparison.status).toBe("blocked");
		expect(comparison.pitch).toBeNull();
	});

	it("fails closed for insufficient audio", () => {
		const comparison = compareTakes(take(1, []), take(2, []));
		expect(comparison.status).toBe("blocked");
		expect(comparison.issues).toContain("insufficient-audio");
	});

	it("blocks aggregate insufficient evidence even if a short phrase was emitted", () => {
		const comparison = compareTakes(
			take(1, cleanBaseline),
			take(2, cleanBaseline, {
				voicedFrames: 2,
				unvoicedFrames: 98,
				issues: ["insufficient-audio", "mostly-unvoiced"],
			}),
		);
		expect(comparison.status).toBe("blocked");
		expect(comparison.pitch).toBeNull();
		expect(comparison.issues).toContain("insufficient-audio");
	});

	it("low-confidence evidence limits, rather than upgrades, feedback", () => {
		const comparison = compareTakes(
			take(1, cleanBaseline),
			take(2, cleanBaseline, {
				voicedFrames: 30,
				lowConfidenceFrames: 50,
				medianConfidence: 0.91,
				issues: ["low-confidence"],
			}),
		);
		expect(comparison.status).toBe("limited");
		expect(comparison.alignmentConfidence).toBeLessThan(0.65);
		expect(comparison.issues).toContain("low-confidence");
	});

	it("flags only materially unvoiced takes, not ordinary between-note gaps", () => {
		const comparison = compareTakes(
			take(1, cleanBaseline),
			take(2, cleanBaseline, {
				voicedFrames: 15,
				unvoicedFrames: 85,
				issues: ["mostly-unvoiced"],
			}),
		);
		expect(comparison.issues).toContain("unvoiced-sections");
		expect(comparison.status).toBe("limited");
		expect(comparison.alignmentConfidence).toBeLessThan(0.65);
	});

	it("keeps explicit out-of-range observations out of ready results", () => {
		const comparison = compareTakes(
			take(1, cleanBaseline),
			take(2, cleanBaseline, {
				voicedFrames: 70,
				unvoicedFrames: 20,
				outOfRangeFrames: 10,
				issues: ["out-of-range"],
			}),
		);
		expect(comparison.status).toBe("limited");
		expect(comparison.issues).toContain("out-of-range");
	});
});

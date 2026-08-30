import type { CaptureEvidence, RawPhrase } from "./capture";
import { DEFAULT_BPM, type Phrase, quantizePhrase } from "./quantize";

export interface TempoEstimate {
	bpm: number;
	confidence: number;
	uncertaintyBpm: number | null;
	source: "inferred";
}

export interface MelodyTake {
	id: number;
	source: "microphone";
	phrase: Phrase;
	evidence: CaptureEvidence;
	tempo: TempoEstimate;
	/** Stop-to-analysis wall time. This excludes the user's recording time. */
	processingLatencyMs: number;
}

export function createMelodyTake(
	id: number,
	evidence: CaptureEvidence,
	processingLatencyMs: number,
): MelodyTake {
	return {
		id,
		source: "microphone",
		// Rehearsal tempo remains analysis evidence; composition quantization keeps
		// Undertone's existing default behavior for save/share/playback compatibility.
		phrase: quantizePhrase(evidence.rawPhrase),
		evidence,
		tempo: estimateTempo(evidence.rawPhrase),
		processingLatencyMs,
	};
}

export type ComparisonIssue =
	| "insufficient-audio"
	| "different-note-count"
	| "low-confidence"
	| "background-noise"
	| "clipping"
	| "unvoiced-sections"
	| "out-of-range"
	| "timing-uncertain"
	| "possible-octave-shift"
	| "octave-mismatch";

export interface PitchNoteComparison {
	baselineIndex: number;
	repeatIndex: number;
	signedCents: number;
	localResidualCents: number;
	possibleOctaveMismatch: boolean;
}

export interface PitchComparison {
	globalShiftCents: number;
	/** Null when the robust shift is not close enough to a semitone. */
	globalTranspositionSemitones: number | null;
	meanAbsoluteLocalErrorCents: number;
	medianAbsoluteLocalErrorCents: number;
	maxAbsoluteLocalErrorCents: number;
	localDriftSlopeCents: number;
	notes: PitchNoteComparison[];
}

export interface TimingComparison {
	tempoSource: "inferred";
	baselineBpm: number;
	repeatBpm: number;
	/** Repeat pace divided by baseline pace. Above 1 is faster. */
	tempoRatio: number;
	meanAbsoluteOnsetErrorMs: number;
	medianAbsoluteOnsetErrorMs: number;
	maxAbsoluteOnsetErrorMs: number;
	onsetUncertaintyMs: number | null;
	uncertain: boolean;
}

export interface TakeComparison {
	status: "ready" | "limited" | "blocked";
	alignmentConfidence: number;
	matchedNotes: number;
	unmatchedBaselineNotes: number;
	unmatchedRepeatNotes: number;
	baselineNotes: number;
	repeatNotes: number;
	issues: ComparisonIssue[];
	pitch: PitchComparison | null;
	timing: TimingComparison | null;
}

function median(values: readonly number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[middle];
}

function mean(values: readonly number[]): number {
	return values.length === 0
		? 0
		: values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp01(value: number): number {
	return Math.max(0, Math.min(1, value));
}

function continuousMidi(frequency: number): number {
	return 69 + 12 * Math.log2(frequency / 440);
}

function signedCents(baselineHz: number, repeatHz: number): number {
	return 100 * (continuousMidi(repeatHz) - continuousMidi(baselineHz));
}

function medianAbsoluteDeviation(values: readonly number[]): number {
	const center = median(values);
	return median(values.map((value) => Math.abs(value - center)));
}

/**
 * Estimate a useful rehearsal pulse from note onsets. Hummed note lengths are
 * not guaranteed to be quarter notes, so this is explicitly an inference and
 * its confidence falls with sparse or irregular evidence.
 */
export function estimateTempo(raw: RawPhrase): TempoEstimate {
	if (raw.length < 2) {
		return {
			bpm: DEFAULT_BPM,
			confidence: 0,
			uncertaintyBpm: null,
			source: "inferred",
		};
	}

	const intervals = raw
		.slice(1)
		.map((note, index) => note.onsetMs - raw[index].onsetMs)
		.filter((interval) => interval > 0 && Number.isFinite(interval));
	if (intervals.length === 0) {
		return {
			bpm: DEFAULT_BPM,
			confidence: 0,
			uncertaintyBpm: null,
			source: "inferred",
		};
	}

	const centerMs = median(intervals);
	let bpm = 60000 / centerMs;
	while (bpm < 60) bpm *= 2;
	while (bpm > 180) bpm /= 2;
	const relativeJitter = medianAbsoluteDeviation(intervals) / centerMs;
	const density = Math.min(1, intervals.length / 4);
	const confidence = clamp01(density * (1 - relativeJitter * 2));
	return {
		bpm: Math.round(bpm),
		confidence,
		uncertaintyBpm: Math.round(bpm * relativeJitter),
		source: "inferred",
	};
}

function qualityReliability(take: MelodyTake): number {
	const quality = take.evidence.quality;
	if (quality.totalFrames === 0) return 0;
	const signalShare = quality.voicedFrames / quality.totalFrames;
	const confidence = quality.medianConfidence ?? 0;
	const clippingPenalty = quality.clippedFrames > 0 ? 0.8 : 1;
	return clamp01(signalShare * confidence * clippingPenalty);
}

function sharedIssues(
	baseline: MelodyTake,
	repeat: MelodyTake,
): ComparisonIssue[] {
	const issues: ComparisonIssue[] = [];
	const summaries = [baseline.evidence.quality, repeat.evidence.quality];
	if (
		summaries.some((quality) => quality.issues.includes("insufficient-audio"))
	)
		issues.push("insufficient-audio");
	if (
		summaries.some(
			(quality) =>
				quality.lowConfidenceFrames > 0 ||
				(quality.medianConfidence ?? 0) < 0.92,
		)
	)
		issues.push("low-confidence");
	if (summaries.some((quality) => quality.noiseFrames > 0))
		issues.push("background-noise");
	if (summaries.some((quality) => quality.clippedFrames > 0))
		issues.push("clipping");
	if (summaries.some((quality) => quality.issues.includes("mostly-unvoiced")))
		issues.push("unvoiced-sections");
	if (summaries.some((quality) => quality.outOfRangeFrames > 0))
		issues.push("out-of-range");
	return issues;
}

interface NotePair {
	baselineIndex: number;
	repeatIndex: number;
}

interface NoteAlignment {
	pairs: NotePair[];
	fit: number;
}

function normalizedOnsets(raw: RawPhrase): number[] {
	if (raw.length < 2) return raw.map(() => 0);
	const first = raw[0].onsetMs;
	const span = Math.max(1, raw[raw.length - 1].onsetMs - first);
	return raw.map((note) => (note.onsetMs - first) / span);
}

function directAlignmentFit(
	baseline: RawPhrase,
	repeat: RawPhrase,
	pairs: readonly NotePair[],
): number {
	const baselineTimes = normalizedOnsets(baseline);
	const repeatTimes = normalizedOnsets(repeat);
	const pitchDeltas = pairs.map((pair) =>
		signedCents(
			baseline[pair.baselineIndex].frequency,
			repeat[pair.repeatIndex].frequency,
		),
	);
	const globalShift = median(pitchDeltas);
	const costs = pairs.map((pair, index) => {
		const onsetCost =
			Math.abs(
				baselineTimes[pair.baselineIndex] - repeatTimes[pair.repeatIndex],
			) * 1.5;
		const contourCost = Math.min(
			1,
			Math.abs(pitchDeltas[index] - globalShift) / 600,
		);
		return onsetCost + contourCost;
	});
	return clamp01(1 - mean(costs) / 1.5);
}

/**
 * Monotonic, bounded alignment for one missed or split note. It uses normalized
 * time plus a coarse transposition-invariant contour cost and never reorders
 * notes. Sparse results are rejected by compareTakes rather than upgraded.
 */
function alignNotes(baseline: RawPhrase, repeat: RawPhrase): NoteAlignment {
	if (baseline.length === repeat.length) {
		const pairs = baseline.map((_, index) => ({
			baselineIndex: index,
			repeatIndex: index,
		}));
		return {
			pairs,
			fit: directAlignmentFit(baseline, repeat, pairs),
		};
	}

	const baselineTimes = normalizedOnsets(baseline);
	const repeatTimes = normalizedOnsets(repeat);
	const coarseDeltas = baseline.map((note, index) => {
		const repeatIndex =
			baseline.length < 2
				? 0
				: Math.round((index * (repeat.length - 1)) / (baseline.length - 1));
		return signedCents(note.frequency, repeat[repeatIndex].frequency);
	});
	const coarseShift = median(coarseDeltas);
	const rows = baseline.length + 1;
	const columns = repeat.length + 1;
	const gapCost = 0.5;
	const costs = Array.from({ length: rows }, () =>
		Array<number>(columns).fill(Number.POSITIVE_INFINITY),
	);
	const moves = Array.from({ length: rows }, () =>
		Array<"match" | "baseline-gap" | "repeat-gap" | null>(columns).fill(null),
	);
	costs[0][0] = 0;
	for (let baselineIndex = 1; baselineIndex < rows; baselineIndex += 1) {
		costs[baselineIndex][0] = baselineIndex * gapCost;
		moves[baselineIndex][0] = "repeat-gap";
	}
	for (let repeatIndex = 1; repeatIndex < columns; repeatIndex += 1) {
		costs[0][repeatIndex] = repeatIndex * gapCost;
		moves[0][repeatIndex] = "baseline-gap";
	}

	for (let baselineIndex = 1; baselineIndex < rows; baselineIndex += 1) {
		for (let repeatIndex = 1; repeatIndex < columns; repeatIndex += 1) {
			const onsetCost =
				Math.abs(
					baselineTimes[baselineIndex - 1] - repeatTimes[repeatIndex - 1],
				) * 2;
			const pitchCost = Math.min(
				1.5,
				Math.abs(
					signedCents(
						baseline[baselineIndex - 1].frequency,
						repeat[repeatIndex - 1].frequency,
					) - coarseShift,
				) / 400,
			);
			const candidates = [
				{
					cost:
						costs[baselineIndex - 1][repeatIndex - 1] + onsetCost + pitchCost,
					move: "match" as const,
				},
				{
					cost: costs[baselineIndex][repeatIndex - 1] + gapCost,
					move: "baseline-gap" as const,
				},
				{
					cost: costs[baselineIndex - 1][repeatIndex] + gapCost,
					move: "repeat-gap" as const,
				},
			].sort((left, right) => left.cost - right.cost);
			costs[baselineIndex][repeatIndex] = candidates[0].cost;
			moves[baselineIndex][repeatIndex] = candidates[0].move;
		}
	}

	const pairs: NotePair[] = [];
	let baselineIndex = baseline.length;
	let repeatIndex = repeat.length;
	while (baselineIndex > 0 || repeatIndex > 0) {
		const move = moves[baselineIndex][repeatIndex];
		if (move === "match") {
			pairs.push({
				baselineIndex: baselineIndex - 1,
				repeatIndex: repeatIndex - 1,
			});
			baselineIndex -= 1;
			repeatIndex -= 1;
		} else if (move === "baseline-gap") {
			repeatIndex -= 1;
		} else {
			baselineIndex -= 1;
		}
	}
	pairs.reverse();
	const normalizedCost =
		costs[baseline.length][repeat.length] /
		Math.max(1, baseline.length, repeat.length);
	return { pairs, fit: clamp01(1 - normalizedCost) };
}

function comparePitch(
	baseline: RawPhrase,
	repeat: RawPhrase,
	pairs: readonly NotePair[],
): PitchComparison {
	const deltas = pairs.map((pair) =>
		signedCents(
			baseline[pair.baselineIndex].frequency,
			repeat[pair.repeatIndex].frequency,
		),
	);
	const globalShiftCents = median(deltas);
	const roundedSemitones = Math.round(globalShiftCents / 100);
	const globalTranspositionSemitones =
		Math.abs(globalShiftCents - roundedSemitones * 100) <= 35
			? roundedSemitones
			: null;
	const residuals = deltas.map((delta) => delta - globalShiftCents);
	const absolutes = residuals.map(Math.abs);
	const notes = deltas.map((delta, index) => {
		const localResidualCents = residuals[index];
		const octaveDistance = Math.abs(localResidualCents) / 1200;
		return {
			baselineIndex: pairs[index].baselineIndex,
			repeatIndex: pairs[index].repeatIndex,
			signedCents: delta,
			localResidualCents,
			possibleOctaveMismatch:
				octaveDistance >= 0.75 &&
				Math.abs(octaveDistance - Math.round(octaveDistance)) <= 0.15,
		};
	});
	return {
		globalShiftCents,
		globalTranspositionSemitones,
		meanAbsoluteLocalErrorCents: mean(absolutes),
		medianAbsoluteLocalErrorCents: median(absolutes),
		maxAbsoluteLocalErrorCents: Math.max(...absolutes),
		localDriftSlopeCents:
			residuals.length < 2 ? 0 : residuals[residuals.length - 1] - residuals[0],
		notes,
	};
}

function compareTiming(
	baseline: MelodyTake,
	repeat: MelodyTake,
	pairs: readonly NotePair[],
): TimingComparison | null {
	const baselineRaw = baseline.evidence.rawPhrase;
	const repeatRaw = repeat.evidence.rawPhrase;
	if (pairs.length < 2) return null;

	const baselineOrigin = baselineRaw[pairs[0].baselineIndex].onsetMs;
	const repeatOrigin = repeatRaw[pairs[0].repeatIndex].onsetMs;
	const baselineTimes = pairs.map(
		(pair) => baselineRaw[pair.baselineIndex].onsetMs - baselineOrigin,
	);
	const repeatTimes = pairs.map(
		(pair) => repeatRaw[pair.repeatIndex].onsetMs - repeatOrigin,
	);
	const denominator = baselineTimes.reduce((sum, time) => sum + time * time, 0);
	if (denominator <= 0) return null;
	const scale =
		baselineTimes.reduce(
			(sum, time, index) => sum + time * repeatTimes[index],
			0,
		) / denominator;
	if (!Number.isFinite(scale) || scale <= 0) return null;

	const residuals = baselineTimes.map(
		(time, index) => repeatTimes[index] - scale * time,
	);
	const absolutes = residuals.map(Math.abs);
	const onsetUncertaintyValues = [
		baseline.evidence.quality.onsetUncertaintyMs,
		repeat.evidence.quality.onsetUncertaintyMs,
	].filter((value): value is number => value !== null);
	const onsetUncertaintyMs =
		onsetUncertaintyValues.length === 0
			? null
			: Math.max(...onsetUncertaintyValues);
	const tempoRatio = 1 / scale;
	const repeatBpm = baseline.tempo.bpm * tempoRatio;
	const uncertain =
		pairs.length < 3 ||
		onsetUncertaintyMs === null ||
		baseline.tempo.confidence < 0.45 ||
		repeat.tempo.confidence < 0.45;
	return {
		tempoSource: "inferred",
		baselineBpm: baseline.tempo.bpm,
		repeatBpm,
		tempoRatio,
		meanAbsoluteOnsetErrorMs: mean(absolutes),
		medianAbsoluteOnsetErrorMs: median(absolutes),
		maxAbsoluteOnsetErrorMs: Math.max(...absolutes),
		onsetUncertaintyMs,
		uncertain,
	};
}

/**
 * Compare two immutable takes. Unequal note counts use a bounded monotonic
 * alignment, but sparse matches remain blocked and every count mismatch lowers
 * the confidence ceiling.
 */
export function compareTakes(
	baseline: MelodyTake,
	repeat: MelodyTake,
): TakeComparison {
	const baselineRaw = baseline.evidence.rawPhrase;
	const repeatRaw = repeat.evidence.rawPhrase;
	const issues = sharedIssues(baseline, repeat);
	if (
		baselineRaw.length === 0 ||
		repeatRaw.length === 0 ||
		issues.includes("insufficient-audio")
	) {
		if (!issues.includes("insufficient-audio"))
			issues.push("insufficient-audio");
		return {
			status: "blocked",
			alignmentConfidence: 0,
			matchedNotes: 0,
			unmatchedBaselineNotes: baselineRaw.length,
			unmatchedRepeatNotes: repeatRaw.length,
			baselineNotes: baselineRaw.length,
			repeatNotes: repeatRaw.length,
			issues,
			pitch: null,
			timing: null,
		};
	}
	const alignment = alignNotes(baselineRaw, repeatRaw);
	const matchedNotes = alignment.pairs.length;
	const unmatchedBaselineNotes = baselineRaw.length - matchedNotes;
	const unmatchedRepeatNotes = repeatRaw.length - matchedNotes;
	const noteCountDifference = Math.abs(baselineRaw.length - repeatRaw.length);
	if (noteCountDifference > 0) issues.push("different-note-count");
	if (matchedNotes < 3 || noteCountDifference > 1) {
		return {
			status: "blocked",
			alignmentConfidence: 0,
			matchedNotes,
			unmatchedBaselineNotes,
			unmatchedRepeatNotes,
			baselineNotes: baselineRaw.length,
			repeatNotes: repeatRaw.length,
			issues,
			pitch: null,
			timing: null,
		};
	}

	const pitch = comparePitch(baselineRaw, repeatRaw, alignment.pairs);
	const timing = compareTiming(baseline, repeat, alignment.pairs);
	const roundedShift = pitch.globalTranspositionSemitones;
	if (
		roundedShift !== null &&
		Math.abs(roundedShift) >= 12 &&
		Math.abs(roundedShift) % 12 === 0
	)
		issues.push("possible-octave-shift");
	if (pitch.notes.some((note) => note.possibleOctaveMismatch))
		issues.push("octave-mismatch");
	if (timing?.uncertain) issues.push("timing-uncertain");

	const reliability = Math.min(
		qualityReliability(baseline),
		qualityReliability(repeat),
	);
	const noteEvidence = Math.min(1, matchedNotes / 4);
	const coverage =
		matchedNotes / Math.max(baselineRaw.length, repeatRaw.length);
	const alignmentConfidence = clamp01(
		reliability * noteEvidence * coverage * alignment.fit,
	);
	const limited =
		matchedNotes < 3 ||
		baselineRaw.length !== repeatRaw.length ||
		alignmentConfidence < 0.65 ||
		issues.some((issue) =>
			[
				"insufficient-audio",
				"low-confidence",
				"background-noise",
				"clipping",
				"unvoiced-sections",
				"out-of-range",
				"timing-uncertain",
			].includes(issue),
		);
	return {
		status: limited ? "limited" : "ready",
		alignmentConfidence,
		matchedNotes,
		unmatchedBaselineNotes,
		unmatchedRepeatNotes,
		baselineNotes: baselineRaw.length,
		repeatNotes: repeatRaw.length,
		issues,
		pitch,
		timing,
	};
}

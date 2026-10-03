import {
	CONFIDENCE_GATE,
	MAX_FREQUENCY_HZ,
	MIN_FREQUENCY_HZ,
	type PitchResult,
	RMS_SILENCE_FLOOR,
} from "./pitch";

/**
 * Note-onset/offset segmentation over a stream of {@link PitchResult} frames.
 *
 * A run of consecutive *voiced* frames (confident + above the silence floor)
 * opens a note; a run of silence or a pitch jump closes it. The hysteresis
 * thresholds below are exported so the operator can retune sensitivity for
 * their mic/room without code changes.
 */

export interface RawNote {
	/** Median fundamental (Hz) across the note's voiced frames. */
	frequency: number;
	/** performance.now() at the note's first voiced frame. */
	onsetMs: number;
	/** Span from onset to last voiced frame, in milliseconds. */
	durationMs: number;
}

export type RawPhrase = RawNote[];

export type CaptureQualityIssue =
	| "insufficient-audio"
	| "mostly-unvoiced"
	| "background-noise"
	| "low-confidence"
	| "clipping"
	| "out-of-range";

/** Session-only evidence retained after the raw frame buffer is released. */
export interface CaptureQualitySummary {
	totalFrames: number;
	voicedFrames: number;
	unvoicedFrames: number;
	noiseFrames: number;
	lowConfidenceFrames: number;
	clippedFrames: number;
	outOfRangeFrames: number;
	medianConfidence: number | null;
	medianFrameIntervalMs: number | null;
	frameIntervalJitterMs: number | null;
	/** Conservative capture-window uncertainty for a detected onset. */
	onsetUncertaintyMs: number | null;
	durationMs: number;
	issues: CaptureQualityIssue[];
}

export interface CaptureEvidence {
	rawPhrase: RawPhrase;
	quality: CaptureQualitySummary;
}

/** Consecutive voiced frames required to open a note (debounces blips). */
export const ONSET_FRAMES = 3;
/** Consecutive silent frames required to close a note (hysteresis). */
export const OFFSET_FRAMES = 5;
/** A voiced frame this far from the note's reference pitch starts a new note. */
export const MAX_NOTE_SHIFT_CENTS = 50;
/** Hard cap on a single capture session. */
export const SESSION_TIMEOUT_MS = 8000;

function isVoiced(frame: PitchResult): boolean {
	return (
		frame.frequency > 0 &&
		frame.confidence >= CONFIDENCE_GATE &&
		frame.rms >= RMS_SILENCE_FLOOR
	);
}

function centsBetween(a: number, b: number): number {
	return 1200 * Math.log2(a / b);
}

function median(values: readonly number[]): number {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[mid - 1] + sorted[mid]) / 2
		: sorted[mid];
}

function medianOrNull(values: readonly number[]): number | null {
	return values.length === 0 ? null : median(values);
}

function medianAbsoluteDeviation(
	values: readonly number[],
	center: number | null,
): number | null {
	return center === null
		? null
		: median(values.map((value) => Math.abs(value - center)));
}

/**
 * Compress the frame buffer into deterministic, non-audio quality evidence.
 * The summary stays in memory for the rehearsal session only; samples and
 * per-frame readings are discarded when capture finishes.
 */
export function summarizeCaptureFrames(
	frames: readonly PitchResult[],
	rawNoteCount: number,
): CaptureQualitySummary {
	let voicedFrames = 0;
	let unvoicedFrames = 0;
	let noiseFrames = 0;
	let lowConfidenceFrames = 0;
	let clippedFrames = 0;
	let outOfRangeFrames = 0;
	const voicedConfidences: number[] = [];

	for (const frame of frames) {
		if (frame.peak >= 0.98) clippedFrames++;
		if (frame.rms < RMS_SILENCE_FLOOR) {
			unvoicedFrames++;
			continue;
		}
		if (frame.frequency <= 0) {
			noiseFrames++;
			continue;
		}
		if (
			frame.frequency < MIN_FREQUENCY_HZ ||
			frame.frequency > MAX_FREQUENCY_HZ
		) {
			outOfRangeFrames++;
			continue;
		}
		if (frame.confidence < CONFIDENCE_GATE) {
			lowConfidenceFrames++;
			continue;
		}
		voicedFrames++;
		voicedConfidences.push(frame.confidence);
	}

	const intervals = frames
		.slice(1)
		.map((frame, index) => frame.timestamp - frames[index].timestamp)
		.filter((interval) => interval >= 0 && Number.isFinite(interval));
	const medianFrameIntervalMs = medianOrNull(intervals);
	const frameIntervalJitterMs = medianAbsoluteDeviation(
		intervals,
		medianFrameIntervalMs,
	);
	const onsetUncertaintyMs =
		medianFrameIntervalMs === null
			? null
			: ONSET_FRAMES * medianFrameIntervalMs + (frameIntervalJitterMs ?? 0);
	const durationMs =
		frames.length < 2
			? 0
			: Math.max(0, frames[frames.length - 1].timestamp - frames[0].timestamp);
	const issues: CaptureQualityIssue[] = [];
	if (rawNoteCount === 0 || voicedFrames < ONSET_FRAMES)
		issues.push("insufficient-audio");
	if (frames.length > 0 && unvoicedFrames / frames.length >= 0.6)
		issues.push("mostly-unvoiced");
	if (noiseFrames > 0) issues.push("background-noise");
	if (lowConfidenceFrames > 0) issues.push("low-confidence");
	if (clippedFrames > 0) issues.push("clipping");
	if (outOfRangeFrames > 0) issues.push("out-of-range");

	return {
		totalFrames: frames.length,
		voicedFrames,
		unvoicedFrames,
		noiseFrames,
		lowConfidenceFrames,
		clippedFrames,
		outOfRangeFrames,
		medianConfidence: medianOrNull(voicedConfidences),
		medianFrameIntervalMs,
		frameIntervalJitterMs,
		onsetUncertaintyMs,
		durationMs,
		issues,
	};
}

export function captureEvidenceFromFrames(
	frames: readonly PitchResult[],
): CaptureEvidence {
	const rawPhrase = reduceFramesToPhrase(frames);
	return {
		rawPhrase,
		quality: summarizeCaptureFrames(frames, rawPhrase.length),
	};
}

/**
 * Pure core: fold a frame stream into a {@link RawPhrase}. Single forward pass,
 * no side effects — the unit of truth the tests and {@link CaptureSession} share.
 */
export function reduceFramesToPhrase(
	frames: readonly PitchResult[],
): RawPhrase {
	const notes: RawNote[] = [];

	let voicedRun: PitchResult[] = [];
	let inNote = false;
	let onsetMs = 0;
	let noteFreqs: number[] = [];
	let lastVoicedMs = 0;
	let belowRun = 0;

	const endNote = (): void => {
		if (noteFreqs.length > 0) {
			notes.push({
				frequency: median(noteFreqs),
				onsetMs,
				durationMs: Math.max(0, lastVoicedMs - onsetMs),
			});
		}
		inNote = false;
		noteFreqs = [];
		belowRun = 0;
	};

	const beginNote = (run: PitchResult[]): void => {
		inNote = true;
		onsetMs = run[0].timestamp;
		noteFreqs = run.map((f) => f.frequency);
		lastVoicedMs = run[run.length - 1].timestamp;
		belowRun = 0;
		voicedRun = [];
	};

	for (const frame of frames) {
		const voiced = isVoiced(frame);

		if (!inNote) {
			if (voiced) {
				voicedRun.push(frame);
				if (voicedRun.length >= ONSET_FRAMES) beginNote(voicedRun);
			} else {
				voicedRun = [];
			}
			continue;
		}

		if (voiced) {
			if (
				Math.abs(
					centsBetween(frame.frequency, noteFreqs[noteFreqs.length - 1]),
				) > MAX_NOTE_SHIFT_CENTS
			) {
				// An abrupt frame-to-frame jump without silence starts a new note.
				// Comparing with the previous voiced frame keeps a gradual portamento
				// inside one uncertain note instead of inventing repeated onsets.
				endNote();
				voicedRun = [frame];
			} else {
				noteFreqs.push(frame.frequency);
				lastVoicedMs = frame.timestamp;
				belowRun = 0;
			}
		} else {
			belowRun++;
			if (belowRun >= OFFSET_FRAMES) endNote();
		}
	}

	if (inNote) endNote();
	return notes;
}

/**
 * Stateful wrapper around {@link reduceFramesToPhrase} for the real-time RAF
 * loop: buffer frames as they arrive, enforce the session timeout, and fold to
 * a phrase on stop. Keeping the algorithm in the pure function keeps this class
 * a thin, easily-verified shell.
 */
export class CaptureSession {
	private frames: PitchResult[] = [];
	private startMs: number | null = null;
	private ended = false;

	push(frame: PitchResult): void {
		if (this.ended) return;
		if (this.startMs === null) this.startMs = frame.timestamp;
		if (frame.timestamp - this.startMs > SESSION_TIMEOUT_MS) {
			this.ended = true;
			return;
		}
		this.frames.push(frame);
	}

	finish(): RawPhrase {
		return this.finishEvidence().rawPhrase;
	}

	finishEvidence(): CaptureEvidence {
		this.ended = true;
		const evidence = captureEvidenceFromFrames(this.frames);
		// The rehearsal model retains only note timing/frequency plus aggregate
		// quality. Release frame-by-frame readings immediately after summarizing.
		this.frames = [];
		return evidence;
	}

	get isCapturing(): boolean {
		return !this.ended;
	}
}

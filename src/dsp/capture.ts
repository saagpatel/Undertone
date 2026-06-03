import { CONFIDENCE_GATE, type PitchResult, RMS_SILENCE_FLOOR } from "./pitch";

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
	let refFreq = 0;
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
		refFreq = median(noteFreqs);
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
				Math.abs(centsBetween(frame.frequency, refFreq)) > MAX_NOTE_SHIFT_CENTS
			) {
				// Pitch jumped without an intervening silence — close this note and
				// start tracking the next one from this frame.
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
		this.ended = true;
		return reduceFramesToPhrase(this.frames);
	}

	get isCapturing(): boolean {
		return !this.ended;
	}
}

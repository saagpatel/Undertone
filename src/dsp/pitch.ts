/**
 * Real-time monophonic pitch detection via normalized autocorrelation.
 *
 * This is the load-bearing primitive: if the frequency it reports is wrong,
 * every downstream layer (capture → quantize → notation) is wrong too. It runs
 * on a 2048-sample time-domain frame from an AnalyserNode at ~60 fps.
 *
 * The internals are deliberately swappable behind {@link PitchResult}: the
 * documented fallback (McLeod Pitch Method) could replace the body without
 * changing a single caller.
 */

export interface PitchResult {
	/** Detected fundamental in Hz; 0 means silence / no confident pitch. */
	frequency: number;
	/** Normalized autocorrelation peak strength, 0..1. Gate notes at >= 0.9. */
	confidence: number;
	/** Root-mean-square amplitude of the frame. Gate silence at < 0.01. */
	rms: number;
	/** Capture time of the reading (performance.now()). */
	timestamp: number;
}

/** Below this RMS the frame is treated as silence, never as a note. */
export const RMS_SILENCE_FLOOR = 0.01;

/** Minimum normalized peak strength to treat a reading as a real pitch. */
export const CONFIDENCE_GATE = 0.9;

/** Vocal-range clamp for the lag search; bounds the fundamental we'll report. */
export const MIN_FREQUENCY_HZ = 130; // ~C3
export const MAX_FREQUENCY_HZ = 1047; // ~C6

/** A peak counts as the fundamental once it reaches this fraction of the best. */
const PEAK_ACCEPT_RATIO = 0.9;

function silenceResult(rms: number): PitchResult {
	return { frequency: 0, confidence: 0, rms, timestamp: performance.now() };
}

export function detectPitch(
	buffer: Float32Array,
	sampleRate: number,
): PitchResult {
	const n = buffer.length;

	// Prefix sums of squares give O(1) windowed energy per lag and the frame RMS.
	const prefixSq = new Float64Array(n + 1);
	for (let i = 0; i < n; i++) {
		prefixSq[i + 1] = prefixSq[i] + buffer[i] * buffer[i];
	}
	const rms = Math.sqrt(prefixSq[n] / n);
	if (rms < RMS_SILENCE_FLOOR) return silenceResult(rms);

	const minLag = Math.max(2, Math.floor(sampleRate / MAX_FREQUENCY_HZ));
	const maxLag = Math.min(n - 1, Math.ceil(sampleRate / MIN_FREQUENCY_HZ));
	if (maxLag <= minLag) return silenceResult(rms);

	// Normalized autocorrelation (Pearson-style correlation coefficient) per lag.
	// For a clean periodic signal this is ~1.0 at integer multiples of the period.
	const corr = new Float64Array(maxLag + 1);
	let bestCorr = -Infinity;
	for (let lag = minLag; lag <= maxLag; lag++) {
		const overlap = n - lag;
		let ac = 0;
		for (let i = 0; i < overlap; i++) {
			ac += buffer[i] * buffer[i + lag];
		}
		const energyHead = prefixSq[overlap]; // Σ x[0..overlap)²
		const energyTail = prefixSq[n] - prefixSq[lag]; // Σ x[lag..n)²
		const denom = Math.sqrt(energyHead * energyTail);
		const c = denom > 0 ? ac / denom : 0;
		corr[lag] = c;
		if (c > bestCorr) bestCorr = c;
	}

	if (bestCorr <= 0) return silenceResult(rms);

	// Choose the *first* (shortest-lag) peak clearing the accept level. Lower
	// octaves of the true pitch correlate just as strongly at 2×, 3× the period,
	// so taking the earliest strong peak fixes the fundamental, not a sub-octave.
	const acceptLevel = bestCorr * PEAK_ACCEPT_RATIO;
	let chosenLag = -1;
	for (let lag = minLag + 1; lag < maxLag; lag++) {
		if (
			corr[lag] >= acceptLevel &&
			corr[lag] >= corr[lag - 1] &&
			corr[lag] >= corr[lag + 1]
		) {
			chosenLag = lag;
			break;
		}
	}
	if (chosenLag === -1) {
		// No interior local maximum cleared the bar; fall back to the global best.
		for (let lag = minLag; lag <= maxLag; lag++) {
			if (corr[lag] === bestCorr) {
				chosenLag = lag;
				break;
			}
		}
	}

	// Sub-sample refinement: 3-point parabolic interpolation of the peak. Integer
	// lags are too coarse to hit ±5 Hz (one lag step near A4 is already ~4 Hz).
	let refinedLag = chosenLag;
	if (chosenLag > minLag && chosenLag < maxLag) {
		const y0 = corr[chosenLag - 1];
		const y1 = corr[chosenLag];
		const y2 = corr[chosenLag + 1];
		const denom = y0 - 2 * y1 + y2;
		if (denom !== 0) {
			const delta = (0.5 * (y0 - y2)) / denom;
			if (delta > -1 && delta < 1) refinedLag = chosenLag + delta;
		}
	}

	const frequency = sampleRate / refinedLag;
	const confidence = Math.min(1, Math.max(0, corr[chosenLag]));
	return { frequency, confidence, rms, timestamp: performance.now() };
}

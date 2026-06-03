/**
 * Synthetic signals for the pitch detector. Pure, deterministic generators —
 * no Web Audio, no randomness — so DSP tests are fast and repeatable. Reused
 * across phases (capture/quantize tests will build on these).
 */

/** Generate a mono sine wave as `length` samples at `sampleRate`. */
export function makeSine(
	frequency: number,
	sampleRate: number,
	length: number,
	amplitude = 1,
): Float32Array {
	const buffer = new Float32Array(length);
	const angularPerSample = (2 * Math.PI * frequency) / sampleRate;
	for (let i = 0; i < length; i++) {
		buffer[i] = amplitude * Math.sin(angularPerSample * i);
	}
	return buffer;
}

/** AnalyserNode frame: 2048 samples at 44.1 kHz (≈46 ms). */
export const SAMPLE_RATE = 44100;
export const FRAME_SIZE = 2048;

/** A4 = 440 Hz reference tone, one analysis frame. */
export const sineA4 = makeSine(440, SAMPLE_RATE, FRAME_SIZE);

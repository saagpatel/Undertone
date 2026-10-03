export const HUMMING_SAMPLE_RATE = 48_000;
export const HUMMING_FRAME_SIZE = 2_048;

export interface HummingFrameOptions {
	frequency: number;
	startSeconds?: number;
	amplitude?: number;
	breathNoise?: number;
	vibratoCents?: number;
	glideCents?: number;
	seed?: number;
}

function deterministicNoise(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state ^= state << 13;
		state ^= state >>> 17;
		state ^= state << 5;
		return ((state >>> 0) / 0xffffffff) * 2 - 1;
	};
}

/**
 * Deterministic, project-owned humming-like signal.
 *
 * This is deliberately more voice-shaped than a clean tone: it includes a
 * harmonic roll-off, slow amplitude motion, vibrato, a bounded pitch glide,
 * and breath noise. It is still synthetic and cannot stand in for a human
 * vocal recording.
 */
export function makeHummingFrame({
	frequency,
	startSeconds = 0,
	amplitude = 0.48,
	breathNoise = 0.018,
	vibratoCents = 14,
	glideCents = 0,
	seed = 0x51a7f00d,
}: HummingFrameOptions): Float32Array {
	const frame = new Float32Array(HUMMING_FRAME_SIZE);
	const noise = deterministicNoise(seed + Math.floor(startSeconds * 1_000));
	let phase = 2 * Math.PI * frequency * startSeconds;

	for (let index = 0; index < frame.length; index += 1) {
		const localSeconds = index / HUMMING_SAMPLE_RATE;
		const absoluteSeconds = startSeconds + localSeconds;
		const progress = index / Math.max(1, frame.length - 1);
		const cents =
			vibratoCents * Math.sin(2 * Math.PI * 5.2 * absoluteSeconds) +
			glideCents * (progress - 0.5);
		const instantaneousFrequency = frequency * 2 ** (cents / 1_200);
		phase += (2 * Math.PI * instantaneousFrequency) / HUMMING_SAMPLE_RATE;
		const amplitudeMotion =
			0.94 + 0.06 * Math.sin(2 * Math.PI * 2.1 * absoluteSeconds);
		const voiced =
			0.64 * Math.sin(phase) +
			0.2 * Math.sin(phase * 2 + 0.18) +
			0.09 * Math.sin(phase * 3 + 0.37) +
			0.04 * Math.sin(phase * 4 + 0.61);
		frame[index] = amplitude * amplitudeMotion * voiced + breathNoise * noise();
	}
	return frame;
}

export function silentHummingFrame(): Float32Array {
	return new Float32Array(HUMMING_FRAME_SIZE);
}

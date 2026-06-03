import { useEffect, useRef, useState } from "react";
import { detectPitch, type PitchResult } from "../dsp/pitch";

/**
 * Drives a ~60 fps requestAnimationFrame loop that pulls the latest time-domain
 * frame from the analyser and runs it through {@link detectPitch}. Phase 0
 * surfaces only the live reading; Phase 1 will layer a CaptureSession on top to
 * assemble a Phrase from the stream of readings.
 */
export function useCapture(
	analyser: AnalyserNode | null,
	sampleRate: number,
): PitchResult | null {
	const [pitch, setPitch] = useState<PitchResult | null>(null);
	const rafRef = useRef<number | null>(null);

	useEffect(() => {
		if (!analyser) {
			setPitch(null);
			return;
		}

		const buffer = new Float32Array(analyser.fftSize);

		const tick = () => {
			analyser.getFloatTimeDomainData(buffer);
			setPitch(detectPitch(buffer, sampleRate));
			rafRef.current = requestAnimationFrame(tick);
		};
		rafRef.current = requestAnimationFrame(tick);

		return () => {
			if (rafRef.current !== null) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
		};
	}, [analyser, sampleRate]);

	return pitch;
}

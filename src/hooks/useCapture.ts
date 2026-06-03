import { useCallback, useEffect, useRef, useState } from "react";
import { CaptureSession } from "../dsp/capture";
import { detectPitch, type PitchResult } from "../dsp/pitch";
import { type Phrase, quantizePhrase } from "../dsp/quantize";
import { useAudioCapture } from "./useAudioCapture";

export interface Capture {
	/** Live per-frame reading while listening (drives the PitchMeter). */
	pitch: PitchResult | null;
	/** Quantized phrase from the last stop; null until the first capture ends. */
	phrase: Phrase | null;
	/** True while the mic is open and frames are being collected. */
	isCapturing: boolean;
	/** Mic / AudioContext error message, if any. */
	error: string | null;
	/** Begin a fresh capture (clears the previous phrase). */
	start: () => Promise<void>;
	/** Stop, fold the collected frames into a quantized phrase. */
	stop: () => void;
}

/**
 * Phase 1 capture orchestrator: composes {@link useAudioCapture}, runs the
 * ~60 fps detection loop, feeds each reading into a {@link CaptureSession}, and
 * quantizes the result into a {@link Phrase} on stop.
 */
export function useCapture(): Capture {
	const audio = useAudioCapture();
	const [pitch, setPitch] = useState<PitchResult | null>(null);
	const [phrase, setPhrase] = useState<Phrase | null>(null);
	const sessionRef = useRef<CaptureSession | null>(null);
	const rafRef = useRef<number | null>(null);

	// Detection loop: read a frame, surface the live pitch, feed the session.
	useEffect(() => {
		const analyser = audio.analyser;
		if (!analyser) {
			setPitch(null);
			return;
		}

		const buffer = new Float32Array(analyser.fftSize);
		const tick = () => {
			analyser.getFloatTimeDomainData(buffer);
			const reading = detectPitch(buffer, audio.sampleRate);
			setPitch(reading);
			sessionRef.current?.push(reading);
			rafRef.current = requestAnimationFrame(tick);
		};
		rafRef.current = requestAnimationFrame(tick);

		return () => {
			if (rafRef.current !== null) {
				cancelAnimationFrame(rafRef.current);
				rafRef.current = null;
			}
		};
	}, [audio.analyser, audio.sampleRate]);

	const start = useCallback(async () => {
		setPhrase(null);
		sessionRef.current = new CaptureSession();
		await audio.start();
	}, [audio.start]);

	const stop = useCallback(() => {
		// Detach the session first so any in-flight RAF tick stops feeding it.
		const session = sessionRef.current;
		sessionRef.current = null;
		audio.stop();
		if (session) setPhrase(quantizePhrase(session.finish()));
		setPitch(null);
	}, [audio.stop]);

	return {
		pitch,
		phrase,
		isCapturing: audio.state === "running",
		error: audio.error,
		start,
		stop,
	};
}

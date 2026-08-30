import { useCallback, useEffect, useRef, useState } from "react";
import { CaptureSession } from "../dsp/capture";
import { detectPitch, type PitchResult } from "../dsp/pitch";
import type { Phrase } from "../dsp/quantize";
import { createMelodyTake, type MelodyTake } from "../dsp/rehearsal";
import { useAudioCapture } from "./useAudioCapture";

export interface Capture {
	/** Live per-frame reading while listening (drives the PitchMeter). */
	pitch: PitchResult | null;
	/** Quantized phrase from the last stop; null until the first capture ends. */
	phrase: Phrase | null;
	/** Session-only evidence for confidence-aware rehearsal; never persisted. */
	take: MelodyTake | null;
	/**
	 * Increments once per completed capture. Consumers use this rather than the
	 * identity of `phrase` to detect "the user just hummed something new" —
	 * two takes can produce equal phrases, and equal phrases are still two
	 * separate captures.
	 */
	captureId: number;
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
	const [take, setTake] = useState<MelodyTake | null>(null);
	const [captureId, setCaptureId] = useState(0);
	const nextCaptureIdRef = useRef(0);
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
		setTake(null);
		sessionRef.current = new CaptureSession();
		await audio.start();
	}, [audio.start]);

	const stop = useCallback(() => {
		// Detach the session first so any in-flight RAF tick stops feeding it.
		const session = sessionRef.current;
		sessionRef.current = null;
		audio.stop();
		if (session) {
			const analysisStarted = performance.now();
			const evidence = session.finishEvidence();
			const id = ++nextCaptureIdRef.current;
			const nextTake = createMelodyTake(
				id,
				evidence,
				performance.now() - analysisStarted,
			);
			setPhrase(nextTake.phrase);
			setTake(nextTake);
			setCaptureId(id);
		}
		setPitch(null);
	}, [audio.stop]);

	return {
		pitch,
		phrase,
		take,
		captureId,
		isCapturing: audio.state === "running",
		error: audio.error,
		start,
		stop,
	};
}

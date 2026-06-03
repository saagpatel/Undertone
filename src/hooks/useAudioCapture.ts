import { useCallback, useEffect, useRef, useState } from "react";

export type CaptureState = "idle" | "running" | "error";

export interface AudioCapture {
	/** Lifecycle of the underlying AudioContext. */
	state: CaptureState;
	/** Human-readable failure reason when state is 'error', else null. */
	error: string | null;
	/** Live AnalyserNode while running, else null. */
	analyser: AnalyserNode | null;
	/** Hardware sample rate (Hz) while running, else 0. */
	sampleRate: number;
	/** Request mic access and start analysis. MUST be called from a user gesture. */
	start: () => Promise<void>;
	/** Release the mic stream and tear down the AudioContext. */
	stop: () => void;
}

/** AnalyserNode frame size — matches the DSP fixtures and detectPitch window. */
export const ANALYSER_FFT_SIZE = 2048;

/**
 * Owns the AudioContext → AnalyserNode lifecycle for mic capture. Construction
 * is deferred to {@link AudioCapture.start} so it always happens inside a user
 * gesture (browser autoplay policy); a suspended context is resumed rather than
 * rebuilt. Nothing is connected to the output — we analyse the mic, we don't
 * play it back.
 */
export function useAudioCapture(): AudioCapture {
	const [state, setState] = useState<CaptureState>("idle");
	const [error, setError] = useState<string | null>(null);
	const [analyser, setAnalyser] = useState<AnalyserNode | null>(null);
	const [sampleRate, setSampleRate] = useState(0);

	// Refs (not state): needed only for teardown, never for rendering.
	const contextRef = useRef<AudioContext | null>(null);
	const streamRef = useRef<MediaStream | null>(null);
	const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
	// Guards against a second start() while the first is still awaiting the mic
	// permission prompt (a rapid double-click would otherwise leak a stream).
	const startingRef = useRef(false);

	const start = useCallback(async () => {
		setError(null);

		// Resume an existing (suspended) context instead of building a second one.
		const existing = contextRef.current;
		if (existing) {
			if (existing.state === "suspended") await existing.resume();
			setState("running");
			return;
		}

		if (startingRef.current) return;

		if (!navigator.mediaDevices?.getUserMedia) {
			setError("Microphone needs a secure context (https or localhost).");
			setState("error");
			return;
		}

		startingRef.current = true;
		let stream: MediaStream | null = null;
		try {
			stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const context = new AudioContext();
			if (context.state === "suspended") await context.resume();

			const source = context.createMediaStreamSource(stream);
			const node = context.createAnalyser();
			node.fftSize = ANALYSER_FFT_SIZE;
			node.smoothingTimeConstant = 0;
			source.connect(node);

			streamRef.current = stream;
			contextRef.current = context;
			sourceRef.current = source;
			setAnalyser(node);
			setSampleRate(context.sampleRate);
			setState("running");
		} catch (err) {
			// Release the mic if we acquired it before a later step failed.
			stream?.getTracks().forEach((track) => track.stop());
			setError(
				err instanceof Error ? err.message : "Microphone access failed.",
			);
			setState("error");
		} finally {
			startingRef.current = false;
		}
	}, []);

	const stop = useCallback(() => {
		streamRef.current?.getTracks().forEach((track) => track.stop());
		sourceRef.current?.disconnect();
		void contextRef.current?.close();

		streamRef.current = null;
		sourceRef.current = null;
		contextRef.current = null;
		setAnalyser(null);
		setSampleRate(0);
		setState("idle");
	}, []);

	// Safety net: release the mic and close the context if the host unmounts
	// mid-capture. Uses refs only, so no stale-closure hazard.
	useEffect(() => {
		return () => {
			streamRef.current?.getTracks().forEach((track) => track.stop());
			void contextRef.current?.close();
		};
	}, []);

	return { state, error, analyser, sampleRate, start, stop };
}

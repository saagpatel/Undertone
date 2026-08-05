import { useEffect, useRef, useState } from "react";
import type { Phrase } from "../dsp/quantize";

/** One input modality's completed-take output. */
export interface CaptureSource {
	phrase: Phrase | null;
	/** Increments once per completed take from this source. */
	captureId: number;
}

export interface LatestCapture {
	phrase: Phrase | null;
	/**
	 * Total completed takes across every source. Monotonic, because each
	 * source's own counter only ever increases — so it changes exactly when
	 * someone finishes a take, and never merely because the input was switched.
	 */
	captureId: number;
}

/**
 * Pick the most recently completed take across several input modalities.
 *
 * The microphone and a MIDI keyboard each produce phrases independently. What
 * belongs on screen is whichever was performed last, not whichever input
 * happens to be selected — switching from mic to MIDI to look at the device
 * picker must not blank a score you just hummed.
 */
export function useLatestCapture(sources: readonly CaptureSource[]): LatestCapture {
	const [phrase, setPhrase] = useState<Phrase | null>(null);
	const previousIdsRef = useRef<number[]>(sources.map((s) => s.captureId));

	const captureIds = sources.map((source) => source.captureId);
	const total = captureIds.reduce((sum, id) => sum + id, 0);
	// Depend on the ids, not on the source objects, which are new every render.
	const idKey = captureIds.join(",");

	useEffect(() => {
		const previous = previousIdsRef.current;
		const advanced = sources.findIndex(
			(source, index) => source.captureId !== (previous[index] ?? 0),
		);
		previousIdsRef.current = sources.map((source) => source.captureId);
		if (advanced === -1) return;
		setPhrase(sources[advanced].phrase);
		// Keyed on idKey alone. `sources` is rebuilt every render, so depending on
		// it would re-run this constantly; a changed id is the only thing that
		// actually means a take completed.
	}, [idKey]);

	return { phrase, captureId: total };
}

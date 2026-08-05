import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { detectKey } from "../dsp/key";
import type { Phrase } from "../dsp/quantize";
import type { Composition } from "../storage/types";

/** Where the score currently on screen came from. */
export type CompositionSource = "capture" | "loaded" | "none";

export interface ActiveComposition {
	composition: Composition | null;
	source: CompositionSource;
	/** Show a composition that did not come from the microphone. */
	load: (composition: Composition) => void;
	/** Drop a loaded composition and fall back to the last capture. */
	clearLoaded: () => void;
}

/**
 * Reconcile the two things that can put a score on screen: a fresh microphone
 * capture, and a composition loaded from the library, a file, or a share link.
 *
 * A new capture always wins — humming something is an unambiguous request to
 * see it — so a completed capture clears any loaded composition. Loading is
 * the only other way to change what is displayed.
 *
 * "A new capture" is keyed on `captureId`, not on the identity of `phrase`.
 * Inferring it from object identity would silently discard a user's loaded
 * composition whenever a caller happened to rebuild the phrase object, and
 * would miss the case where two takes produce equal phrases.
 *
 * The key is detected once per captured phrase and carried verbatim on a
 * loaded one, so a restored score never re-derives a key that might disagree
 * with the harmony it was saved with.
 */
export function useActiveComposition(
	capturedPhrase: Phrase | null,
	captureId: number,
): ActiveComposition {
	const [loaded, setLoaded] = useState<Composition | null>(null);
	const lastCaptureIdRef = useRef(captureId);

	// A completed capture supersedes whatever was loaded.
	useEffect(() => {
		if (captureId === lastCaptureIdRef.current) return;
		lastCaptureIdRef.current = captureId;
		setLoaded(null);
	}, [captureId]);

	const captured = useMemo<Composition | null>(() => {
		if (capturedPhrase === null) return null;
		return {
			phrase: capturedPhrase,
			key: capturedPhrase.notes.length > 0 ? detectKey(capturedPhrase) : null,
		};
	}, [capturedPhrase]);

	const load = useCallback((composition: Composition) => {
		setLoaded(composition);
	}, []);

	const clearLoaded = useCallback(() => {
		setLoaded(null);
	}, []);

	const composition = loaded ?? captured;
	const source: CompositionSource = loaded
		? "loaded"
		: captured
			? "capture"
			: "none";

	return { composition, source, load, clearLoaded };
}

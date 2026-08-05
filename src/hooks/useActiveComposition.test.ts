import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { NoteEvent, Phrase } from "../dsp/quantize";
import { sampleComposition } from "../storage/storeContract";
import { useActiveComposition } from "./useActiveComposition";

function phraseOf(pitch: NoteEvent["pitch"], bpm = 90): Phrase {
	return {
		notes: [
			{ pitch, accidental: null, octave: 4, noteValue: "quarter", beatPosition: 0 },
			{
				pitch: "G",
				accidental: null,
				octave: 4,
				noteValue: "quarter",
				beatPosition: 1,
			},
		],
		timeSignatureNumerator: 4,
		timeSignatureDenominator: 4,
		bpm,
	};
}

describe("useActiveComposition", () => {
	it("reports nothing on a cold start", () => {
		const { result } = renderHook(() => useActiveComposition(null, 0));
		expect(result.current.composition).toBeNull();
		expect(result.current.source).toBe("none");
	});

	it("wraps a captured phrase with its detected key", () => {
		const phrase = phraseOf("C");
		const { result } = renderHook(() => useActiveComposition(phrase, 1));

		expect(result.current.source).toBe("capture");
		expect(result.current.composition?.phrase).toEqual(phrase);
		expect(result.current.composition?.key).not.toBeNull();
	});

	it("leaves the key null for an empty capture, where detection has no input", () => {
		const empty: Phrase = {
			notes: [],
			timeSignatureNumerator: 4,
			timeSignatureDenominator: 4,
			bpm: 90,
		};
		const { result } = renderHook(() => useActiveComposition(empty, 1));
		expect(result.current.composition?.key).toBeNull();
	});

	it("shows a loaded composition over a captured one", () => {
		const loaded = sampleComposition(4);
		const { result } = renderHook(() => useActiveComposition(phraseOf("C"), 1));

		act(() => result.current.load(loaded));

		expect(result.current.source).toBe("loaded");
		expect(result.current.composition).toEqual(loaded);
	});

	it("carries a loaded composition's key verbatim rather than re-detecting it", () => {
		const loaded = {
			...sampleComposition(),
			key: { tonic: "F", accidental: null, mode: "minor" } as const,
		};
		const { result } = renderHook(() => useActiveComposition(null, 0));

		act(() => result.current.load(loaded));

		expect(result.current.composition?.key).toEqual({
			tonic: "F",
			accidental: null,
			mode: "minor",
		});
	});

	it("lets a new capture supersede a loaded composition", () => {
		const { result, rerender } = renderHook(
			({ phrase, id }: { phrase: Phrase | null; id: number }) =>
				useActiveComposition(phrase, id),
			{ initialProps: { phrase: null as Phrase | null, id: 0 } },
		);

		act(() => result.current.load(sampleComposition(9)));
		expect(result.current.source).toBe("loaded");

		const fresh = phraseOf("D", 120);
		rerender({ phrase: fresh, id: 1 });

		expect(result.current.source).toBe("capture");
		expect(result.current.composition?.phrase).toEqual(fresh);
	});

	it("keeps a loaded composition when the captured phrase does not change", () => {
		const phrase = phraseOf("C");
		const loaded = sampleComposition(2);
		const { result, rerender } = renderHook(
			({ p }: { p: Phrase | null }) => useActiveComposition(p, 1),
			{ initialProps: { p: phrase } },
		);

		act(() => result.current.load(loaded));
		// A re-render that rebuilds the phrase object must NOT discard the load.
		rerender({ p: phraseOf("C") });

		expect(result.current.source).toBe("loaded");
		expect(result.current.composition).toEqual(loaded);
	});

	it("falls back to the last capture when a loaded composition is cleared", () => {
		const phrase = phraseOf("C");
		const { result } = renderHook(() => useActiveComposition(phrase, 1));

		act(() => result.current.load(sampleComposition(1)));
		act(() => result.current.clearLoaded());

		expect(result.current.source).toBe("capture");
		expect(result.current.composition?.phrase).toEqual(phrase);
	});
});

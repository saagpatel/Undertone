import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Phrase } from "../dsp/quantize";
import { useLatestCapture } from "./useLatestCapture";
import type { CaptureSource } from "./useLatestCapture";

function phraseOf(bpm: number): Phrase {
	return {
		notes: [
			{
				pitch: "C",
				accidental: null,
				octave: 4,
				noteValue: "quarter",
				beatPosition: 0,
			},
		],
		timeSignatureNumerator: 4,
		timeSignatureDenominator: 4,
		bpm,
	};
}

const NOTHING: CaptureSource = { phrase: null, captureId: 0 };

describe("useLatestCapture", () => {
	it("reports nothing before any take", () => {
		const { result } = renderHook(() => useLatestCapture([NOTHING, NOTHING]));
		expect(result.current.phrase).toBeNull();
		expect(result.current.captureId).toBe(0);
	});

	it("picks up a take from the first source", () => {
		const mic = phraseOf(90);
		const { result, rerender } = renderHook(
			({ sources }: { sources: CaptureSource[] }) => useLatestCapture(sources),
			{ initialProps: { sources: [NOTHING, NOTHING] } },
		);

		rerender({ sources: [{ phrase: mic, captureId: 1 }, NOTHING] });

		expect(result.current.phrase).toEqual(mic);
		expect(result.current.captureId).toBe(1);
	});

	it("picks up a take from the second source", () => {
		const midi = phraseOf(120);
		const { result, rerender } = renderHook(
			({ sources }: { sources: CaptureSource[] }) => useLatestCapture(sources),
			{ initialProps: { sources: [NOTHING, NOTHING] } },
		);

		rerender({ sources: [NOTHING, { phrase: midi, captureId: 1 }] });

		expect(result.current.phrase).toEqual(midi);
	});

	it("shows whichever source performed most recently", () => {
		const mic = phraseOf(90);
		const midi = phraseOf(120);
		const { result, rerender } = renderHook(
			({ sources }: { sources: CaptureSource[] }) => useLatestCapture(sources),
			{ initialProps: { sources: [NOTHING, NOTHING] } },
		);

		rerender({ sources: [{ phrase: mic, captureId: 1 }, NOTHING] });
		expect(result.current.phrase).toEqual(mic);

		rerender({
			sources: [
				{ phrase: mic, captureId: 1 },
				{ phrase: midi, captureId: 1 },
			],
		});
		expect(result.current.phrase).toEqual(midi);

		const mic2 = phraseOf(100);
		rerender({
			sources: [
				{ phrase: mic2, captureId: 2 },
				{ phrase: midi, captureId: 1 },
			],
		});
		expect(result.current.phrase).toEqual(mic2);
	});

	it("sums takes across sources into a monotonic counter", () => {
		const { result, rerender } = renderHook(
			({ sources }: { sources: CaptureSource[] }) => useLatestCapture(sources),
			{ initialProps: { sources: [NOTHING, NOTHING] } },
		);

		rerender({
			sources: [
				{ phrase: phraseOf(90), captureId: 3 },
				{ phrase: phraseOf(120), captureId: 2 },
			],
		});

		expect(result.current.captureId).toBe(5);
	});

	it("holds its phrase across re-renders that complete no take", () => {
		// Switching input source must not blank a score you just recorded.
		const mic = phraseOf(90);
		const { result, rerender } = renderHook(
			({ sources }: { sources: CaptureSource[] }) => useLatestCapture(sources),
			{ initialProps: { sources: [NOTHING, NOTHING] } },
		);

		rerender({ sources: [{ phrase: mic, captureId: 1 }, NOTHING] });
		rerender({ sources: [{ phrase: mic, captureId: 1 }, NOTHING] });
		rerender({ sources: [{ phrase: mic, captureId: 1 }, NOTHING] });

		expect(result.current.phrase).toEqual(mic);
		expect(result.current.captureId).toBe(1);
	});
});

import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import {
	cleanBaseline,
	extraPassingNote,
	transposedUpTwo,
} from "../../tests/fixtures/rehearsal";
import type { CaptureQualitySummary, RawPhrase } from "../dsp/capture";
import { quantizePhrase } from "../dsp/quantize";
import { compareTakes, estimateTempo, type MelodyTake } from "../dsp/rehearsal";
import { RehearsalPanel } from "./RehearsalPanel";

const quality: CaptureQualitySummary = {
	totalFrames: 100,
	voicedFrames: 80,
	unvoicedFrames: 20,
	noiseFrames: 0,
	lowConfidenceFrames: 0,
	clippedFrames: 0,
	outOfRangeFrames: 0,
	medianConfidence: 0.98,
	medianFrameIntervalMs: 16,
	frameIntervalJitterMs: 1,
	onsetUncertaintyMs: 49,
	durationMs: 2100,
	issues: [],
};

function take(id: number, rawPhrase: RawPhrase): MelodyTake {
	const tempo = estimateTempo(rawPhrase);
	return {
		id,
		source: "microphone",
		phrase: quantizePhrase(rawPhrase, { bpm: tempo.bpm }),
		evidence: { rawPhrase, quality },
		tempo,
		processingLatencyMs: 1.2,
	};
}

const baseline = take(1, cleanBaseline);
const repeat = take(2, transposedUpTwo);

function renderPanel(
	overrides: Partial<ComponentProps<typeof RehearsalPanel>> = {},
) {
	const props: ComponentProps<typeof RehearsalPanel> = {
		currentTake: null,
		baseline: null,
		repeat: null,
		comparison: null,
		targetPlaying: false,
		targetProgress: null,
		onStart: vi.fn(),
		onReset: vi.fn(),
		onPlayTarget: vi.fn(),
		onStopTarget: vi.fn(),
		...overrides,
	};
	return { ...render(<RehearsalPanel {...props} />), props };
}

describe("RehearsalPanel", () => {
	it("explains the explicit session and enables a captured take as baseline", () => {
		const { props } = renderPanel({ currentTake: baseline });
		expect(
			screen.getByRole("heading", { name: "Rehearsal loop" }),
		).toBeTruthy();
		expect(screen.getByText("clear evidence")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Use this take as baseline" }),
		);
		expect(props.onStart).toHaveBeenCalledOnce();
	});

	it("shows the target contour and repeat action with accessible progress", () => {
		renderPanel({ baseline, targetProgress: 0.5 });
		expect(
			screen.getByRole("img", {
				name: "Target pitch contour from the baseline take",
			}),
		).toBeTruthy();
		expect(screen.getByText("Record a repeat")).toBeTruthy();
		expect(screen.getByRole("button", { name: "Hear target" })).toBeTruthy();
	});

	it("separates global shift from local variation and states the claim boundary", () => {
		const comparison = compareTakes(baseline, repeat);
		const { container } = renderPanel({ baseline, repeat, comparison });
		expect(screen.getByText("+2 semitones")).toBeTruthy();
		expect(screen.getByText(/0 cents average/)).toBeTruthy();
		const contours = container.querySelectorAll("polyline.contour-line");
		expect(contours).toHaveLength(2);
		expect(contours[0].getAttribute("points")).not.toBe(
			contours[1].getAttribute("points"),
		);
		expect(
			screen.getByText(
				/do not assess vocal health, technique, or demonstrated learning/i,
			),
		).toBeTruthy();
	});

	it("keeps low-confidence feedback descriptive rather than claiming improvement", () => {
		const limitedRepeat: MelodyTake = {
			...repeat,
			evidence: {
				...repeat.evidence,
				quality: {
					...quality,
					voicedFrames: 20,
					lowConfidenceFrames: 60,
					medianConfidence: 0.91,
					issues: ["low-confidence"],
				},
			},
		};
		const comparison = compareTakes(baseline, limitedRepeat);
		renderPanel({ baseline, repeat: limitedRepeat, comparison });
		expect(screen.getByText(/60 low-confidence pitched frames/i)).toBeTruthy();
		expect(screen.getByText(/below the confidence gate/i)).toBeTruthy();
		expect(
			screen.getByText(/region to recheck rather than a verdict/i),
		).toBeTruthy();
		expect(screen.queryByText(/you improved/i)).toBeNull();
	});

	it("treats a one-note alignment as a hypothesis, not a consistency result", () => {
		const countMismatchedRepeat = take(3, extraPassingNote);
		const comparison = compareTakes(baseline, countMismatchedRepeat);
		renderPanel({
			baseline,
			repeat: countMismatchedRepeat,
			comparison,
		});
		expect(screen.getByText(/bounded alignment is a hypothesis/i)).toBeTruthy();
		expect(
			screen.queryByText(/contour stayed comparatively consistent/i),
		).toBeNull();
	});

	it("states session-only retention without implying persistent history", () => {
		renderPanel();
		expect(
			screen.getByText(
				/summary stays in memory for this tab and clears on reload or reset/i,
			),
		).toBeTruthy();
	});
});

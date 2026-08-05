import { describe, expect, it } from "vitest";
import { type AccompanimentStyle, patternize } from "./accompaniment";
import type { VoicedChord } from "./voicing";

// C major, voiced the way voiceChord() lays it out: bass C2, triad C3-E3-G3.
const VOICED: VoicedChord = {
	bass: { pitch: "C", accidental: null, octave: 2 },
	triad: [
		{ pitch: "C", accidental: null, octave: 3 },
		{ pitch: "E", accidental: null, octave: 3 },
		{ pitch: "G", accidental: null, octave: 3 },
	],
};

describe("patternize — block", () => {
	it("places every voice at the slot onset for the full duration", () => {
		const timed = patternize(VOICED, "block", 4);
		expect(timed).toHaveLength(4);
		for (const t of timed) {
			expect(t.beatOffset).toBe(0);
			expect(t.beats).toBe(4);
		}
	});

	it("orders the voices bass → triad (matches the v2 schedule order)", () => {
		const timed = patternize(VOICED, "block", 4);
		expect(timed.map((t) => t.tone)).toEqual([
			VOICED.bass,
			VOICED.triad[0],
			VOICED.triad[1],
			VOICED.triad[2],
		]);
	});
});

describe("patternize — arpeggio", () => {
	it("emits four ascending onsets evenly spanning the slot", () => {
		const timed = patternize(VOICED, "arpeggio", 4);
		expect(timed).toHaveLength(4);
		expect(timed.map((t) => t.beatOffset)).toEqual([0, 1, 2, 3]);
		for (const t of timed) expect(t.beats).toBe(1);
	});

	it("ascends bass → root → third → fifth", () => {
		const timed = patternize(VOICED, "arpeggio", 4);
		expect(timed.map((t) => t.tone)).toEqual([
			VOICED.bass,
			VOICED.triad[0],
			VOICED.triad[1],
			VOICED.triad[2],
		]);
	});

	it("scales onsets and durations to the slot length", () => {
		const timed = patternize(VOICED, "arpeggio", 2);
		expect(timed.map((t) => t.beatOffset)).toEqual([0, 0.5, 1, 1.5]);
		for (const t of timed) expect(t.beats).toBe(0.5);
	});
});

describe("patternize — alberti", () => {
	it("emits the low-high-mid-high four-step cycle", () => {
		const timed = patternize(VOICED, "alberti", 4);
		expect(timed).toHaveLength(4);
		expect(timed.map((t) => t.beatOffset)).toEqual([0, 1, 2, 3]);
		// low = bass, high = triad fifth, mid = triad third, high = triad fifth.
		expect(timed.map((t) => t.tone)).toEqual([
			VOICED.bass,
			VOICED.triad[2],
			VOICED.triad[1],
			VOICED.triad[2],
		]);
	});
});

describe("patternize — invariants across broken styles", () => {
	const broken: AccompanimentStyle[] = ["arpeggio", "alberti"];

	it("keeps every onset inside the slot", () => {
		for (const style of broken) {
			for (const t of patternize(VOICED, style, 4)) {
				expect(t.beatOffset).toBeGreaterThanOrEqual(0);
				expect(t.beatOffset + t.beats).toBeLessThanOrEqual(4 + 1e-9);
			}
		}
	});

	it("tiles the slot edge-to-edge with no gaps or overlaps", () => {
		for (const style of broken) {
			const timed = patternize(VOICED, style, 4);
			for (let i = 1; i < timed.length; i++) {
				expect(timed[i].beatOffset).toBeCloseTo(
					timed[i - 1].beatOffset + timed[i - 1].beats,
					9,
				);
			}
		}
	});
});

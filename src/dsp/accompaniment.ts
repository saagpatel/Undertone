import type { VoicedChord, VoicedTone } from "./voicing";

/**
 * Accompaniment texture for a voiced chord. `block` is the v2 default — every
 * voice struck together; the broken styles spread the voices across the slot.
 */
export type AccompanimentStyle = "block" | "arpeggio" | "alberti";

/** A voiced tone placed within an accompaniment slot. */
export interface TimedTone {
	tone: VoicedTone;
	/** Beats from the slot start where this tone begins. */
	beatOffset: number;
	/** Sounding duration in beats. */
	beats: number;
}

/** Voices per pattern step: bass + the three triad tones. */
const STEPS = 4;

/**
 * Map a {@link VoicedChord} to per-tone onsets within a slot of `slotBeats`,
 * according to `style`. Pure — depends only on its arguments.
 *
 *  - `block`    — all four voices at offset 0 for the whole slot (v2 parity).
 *  - `arpeggio` — bass → root → third → fifth, one rising voice per quarter of
 *    the slot.
 *  - `alberti`  — the classic low-high-mid-high cycle (bass, fifth, third,
 *    fifth), one voice per quarter of the slot.
 *
 * The tone references are passed through verbatim, so callers can identify the
 * bass voice by reference equality with `voiced.bass`.
 */
export function patternize(
	voiced: VoicedChord,
	style: AccompanimentStyle,
	slotBeats: number,
): TimedTone[] {
	const { bass, triad } = voiced;

	if (style === "block") {
		return [bass, ...triad].map((tone) => ({
			tone,
			beatOffset: 0,
			beats: slotBeats,
		}));
	}

	const step = slotBeats / STEPS;
	const sequence: VoicedTone[] =
		style === "arpeggio"
			? [bass, triad[0], triad[1], triad[2]] // ascending
			: [bass, triad[2], triad[1], triad[2]]; // alberti: low-high-mid-high

	return sequence.map((tone, i) => ({
		tone,
		beatOffset: i * step,
		beats: step,
	}));
}

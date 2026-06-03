import type { NoteEvent, NoteName, NoteValue } from "../dsp/quantize";
import type { StaffGeometry } from "./types";

export const DEFAULT_LINE_SPACING = 10;
const STAFF_LINES = 5;

/** Diatonic position within an octave (C=0 .. B=6). Accidentals don't shift it. */
const DIATONIC_INDEX: Record<NoteName, number> = {
	C: 0,
	D: 1,
	E: 2,
	F: 3,
	G: 4,
	A: 5,
	B: 6,
};

/** A note's absolute diatonic value: octave * 7 + step. */
export function diatonicValue(pitch: NoteName, octave: number): number {
	return octave * 7 + DIATONIC_INDEX[pitch];
}

/** Treble clef: the top staff line is F5; the middle line is B4. */
const TOP_LINE_DIATONIC = diatonicValue("F", 5); // 38
export const MIDDLE_LINE_DIATONIC = diatonicValue("B", 4); // 34

export function staffGeometry(
	opts: Partial<StaffGeometry> = {},
): StaffGeometry {
	return {
		x: opts.x ?? 40,
		y: opts.y ?? 40,
		width: opts.width ?? 600,
		lineSpacing: opts.lineSpacing ?? DEFAULT_LINE_SPACING,
		numLines: STAFF_LINES,
	};
}

/**
 * Y-coordinate (px) of a note's vertical center on the staff. The top line sits
 * at `geom.y`; each diatonic step downward adds half a line space. Higher pitches
 * therefore yield smaller y (toward the top), matching SVG's downward y-axis.
 */
export function notePosition(
	note: Pick<NoteEvent, "pitch" | "octave">,
	geom: StaffGeometry,
): number {
	const steps = TOP_LINE_DIATONIC - diatonicValue(note.pitch, note.octave);
	return geom.y + steps * (geom.lineSpacing / 2);
}

const BEAMABLE: ReadonlySet<NoteValue> = new Set(["eighth", "sixteenth"]);

export function isBeamable(noteValue: NoteValue): boolean {
	return BEAMABLE.has(noteValue);
}

/**
 * Partition notes into render groups: each maximal run of consecutive beamable
 * (eighth/sixteenth) notes stays together; every other note is its own group.
 * The renderer beams a group only when it is beamable and has 2+ members.
 */
export function beamGroups(notes: readonly NoteEvent[]): NoteEvent[][] {
	const groups: NoteEvent[][] = [];
	let run: NoteEvent[] = [];

	for (const note of notes) {
		if (isBeamable(note.noteValue)) {
			run.push(note);
		} else {
			if (run.length > 0) {
				groups.push(run);
				run = [];
			}
			groups.push([note]);
		}
	}
	if (run.length > 0) groups.push(run);

	return groups;
}

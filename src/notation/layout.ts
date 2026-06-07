import {
	NOTE_VALUE_BEATS,
	type NoteEvent,
	type NoteName,
	type NoteValue,
	type Phrase,
} from "../dsp/quantize";
import type { StaffGeometry } from "./types";

export const DEFAULT_LINE_SPACING = 10;

/** Horizontal factors for beat→x mapping. Kept here as the single source of truth. */
export const CLEF_GAP_FACTOR = 4; // staff spaces reserved for the clef before note 1
export const TIME_SIG_GAP = 2.5; // staff spaces reserved for the time signature after the clef
export const PIXELS_PER_BEAT_FACTOR = 3.2; // horizontal spread per quarter-note beat

/**
 * Convert a beat position to an x-coordinate on the staff. The clef occupies
 * `CLEF_GAP_FACTOR` line spacings and the time signature a further
 * `TIME_SIG_GAP` to the left of beat 0. Both the treble and bass staves share
 * one geometry's `x`/`lineSpacing`, so this is the single source of x-truth that
 * keeps the two staves' beat columns vertically aligned.
 */
export function beatToX(beatPosition: number, geom: StaffGeometry): number {
	const leftMargin =
		geom.x + geom.lineSpacing * (CLEF_GAP_FACTOR + TIME_SIG_GAP);
	const pxPerBeat = geom.lineSpacing * PIXELS_PER_BEAT_FACTOR;
	return leftMargin + beatPosition * pxPerBeat;
}
const STAFF_LINES = 5;

/**
 * Beat where the phrase ends: the latest note's end (onset + value), in
 * quarter-note units. Order-independent — never assumes notes are sorted.
 * Returns 0 for an empty phrase.
 */
export function phraseEndBeat(phrase: Phrase): number {
	return phrase.notes.reduce(
		(end, n) => Math.max(end, n.beatPosition + NOTE_VALUE_BEATS[n.noteValue]),
		0,
	);
}

/**
 * Internal barline beat positions for a phrase: every measure boundary strictly
 * between the start and the phrase end. Beats per measure is the time-signature
 * numerator (quarter-note beats), matching how {@link harmonize} slices measures
 * so barlines fall on the same boundaries as the chord slots. The final barline
 * (at the phrase end) is the renderer's concern, not a boundary here.
 *
 * A 2-measure 4/4 phrase → `[4]`.
 */
export function measureBoundaries(phrase: Phrase): number[] {
	const beatsPerMeasure = phrase.timeSignatureNumerator;
	if (beatsPerMeasure <= 0) return [];
	const end = phraseEndBeat(phrase);
	const boundaries: number[] = [];
	for (let beat = beatsPerMeasure; beat < end; beat += beatsPerMeasure) {
		boundaries.push(beat);
	}
	return boundaries;
}

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

/** Bass clef: the top staff line is A3; F3 is the 4th line up (the clef line). */
const BASS_TOP_LINE_DIATONIC = diatonicValue("A", 3); // 26

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

/**
 * Extra inter-staff gap, in line-spaces, added beyond the continuous diatonic
 * ruler. A pure continuous ruler (where middle C would bridge both staves on one
 * shared position) leaves only a 2-space gap, into which octave-4 chord tones —
 * vi's E4, vii°'s F4 — collide with the treble staff. Widening drops the bass
 * staff so those tones sit in clear space below the treble. This trades the exact
 * middle-C bridge for standard-notation divergence (C4 is one ledger below the
 * treble OR one ledger above the bass — two different y's); x-alignment is
 * unaffected since both staves still derive x from {@link beatToX}.
 */
const INTER_STAFF_GAP_SPACES = 2;

/**
 * Geometry for the bass staff of a grand staff, derived from the treble staff.
 * The bass top line (A3) is placed `F5 → A3` (12 diatonic steps = 6 line spaces)
 * below the treble top line, plus {@link INTER_STAFF_GAP_SPACES} of breathing
 * room so high chord tones clear the treble staff. Shares the treble's x, width,
 * and line spacing, so beats line up vertically across the system.
 */
export function bassStaffGeometry(treble: StaffGeometry): StaffGeometry {
	const rulerSpaces = (TOP_LINE_DIATONIC - BASS_TOP_LINE_DIATONIC) / 2; // 6
	const spacesBelow = rulerSpaces + INTER_STAFF_GAP_SPACES; // 8
	return {
		...treble,
		y: treble.y + spacesBelow * treble.lineSpacing,
	};
}

/**
 * Y-coordinate (px) of a note's vertical center on the BASS staff. Mirrors
 * {@link notePosition} but references the bass top line (A3) instead of F5.
 */
export function notePositionBass(
	note: Pick<NoteEvent, "pitch" | "octave">,
	geom: StaffGeometry,
): number {
	const steps = BASS_TOP_LINE_DIATONIC - diatonicValue(note.pitch, note.octave);
	return geom.y + steps * (geom.lineSpacing / 2);
}

/**
 * Extra bottom clearance for a grand staff, in line-spaces. The bass voice
 * descends below the staff — a deep root (octave 2, up to two ledger lines down)
 * carries a downward stem ~3.5 line-spaces long, which very nearly fills the
 * symmetric `treble.y` margin on its own. This cushion keeps that stem (and the
 * ink-displacement wobble around it) inside the viewBox.
 */
const GRAND_STAFF_BOTTOM_CUSHION = 1;

/**
 * Total SVG canvas height for a notation system rendered from `treble`. The
 * single source of truth for both <NotationCanvas>'s viewBox and the standalone
 * export, so they never drift. A grand staff spans down to the bass bottom line;
 * a single staff stops at the treble bottom line. A symmetric margin of
 * `treble.y` is left below the lowest line (mirroring the top margin); the grand
 * staff adds {@link GRAND_STAFF_BOTTOM_CUSHION} line-spaces to clear the
 * descending bass voice.
 */
export function notationHeight(
	treble: StaffGeometry,
	grandStaff: boolean,
): number {
	const lowestLineGeom = grandStaff ? bassStaffGeometry(treble) : treble;
	const lowestLineY =
		lowestLineGeom.y + (treble.numLines - 1) * treble.lineSpacing;
	const cushion = grandStaff
		? GRAND_STAFF_BOTTOM_CUSHION * treble.lineSpacing
		: 0;
	return lowestLineY + treble.y + cushion;
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

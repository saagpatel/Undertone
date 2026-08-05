import type { Key } from "./key";
import { NOTE_VALUE_BEATS } from "./quantize";
import type { NoteEvent, NoteName, NoteValue, Phrase } from "./quantize";

/**
 * Pure score edits.
 *
 * Every function here takes a {@link Phrase} and returns a **new** one. The SVG
 * renderer stays a one-way `Phrase -> SVG` function, so all editing intent
 * lives here and in the React layer; nothing downstream is ever mutated.
 *
 * Out-of-range indices return the phrase unchanged rather than throwing. An
 * edit is driven by a click or a keypress, and a stale selection is an ordinary
 * race, not a program error.
 */

/** Letter names in ascending diatonic order, for staff-step arithmetic. */
const LETTERS: readonly NoteName[] = ["C", "D", "E", "F", "G", "A", "B"];

/** Note values from longest to shortest, for stepping through durations. */
const VALUES_LONG_TO_SHORT: readonly NoteValue[] = [
	"whole",
	"half",
	"quarter",
	"eighth",
	"sixteenth",
];

/** Semitones above C for each natural letter. */
const NATURAL_SEMITONES: Record<NoteName, number> = {
	C: 0,
	D: 2,
	E: 4,
	F: 5,
	G: 7,
	A: 9,
	B: 11,
};

/** Major and natural-minor scale shapes, in semitones from the tonic. */
const SCALE_SEMITONES: Record<Key["mode"], readonly number[]> = {
	major: [0, 2, 4, 5, 7, 9, 11],
	minor: [0, 2, 3, 5, 7, 8, 10],
};

function accidentalOffset(accidental: NoteEvent["accidental"]): number {
	return accidental === "sharp" ? 1 : accidental === "flat" ? -1 : 0;
}

/**
 * The accidental a letter takes in the given key, so a diatonic move lands
 * in-key rather than a semitone outside it.
 *
 * Built by walking the seven letters from the tonic, because a diatonic scale
 * has exactly one note per letter. Searching pitch classes instead would spell
 * B in F major as B-sharp — enharmonically C, which really is in the scale, and
 * a nonsense spelling on the staff.
 *
 * Returns null when the degree would need a double sharp or double flat, which
 * the note model cannot represent; callers fall back to the note's own
 * accidental.
 */
export function accidentalInKey(
	letter: NoteName,
	key: Key,
): NoteEvent["accidental"] | null {
	const tonicPc =
		(NATURAL_SEMITONES[key.tonic] + accidentalOffset(key.accidental) + 12) % 12;
	const tonicLetterIndex = LETTERS.indexOf(key.tonic);
	const degree =
		(LETTERS.indexOf(letter) - tonicLetterIndex + LETTERS.length) %
		LETTERS.length;

	const targetPc = (tonicPc + SCALE_SEMITONES[key.mode][degree]) % 12;
	// Signed distance from the natural spelling, folded into -6..+5 so a
	// wrap-around at the octave boundary reads as +/-1 rather than +/-11.
	const offset = ((targetPc - NATURAL_SEMITONES[letter] + 18) % 12) - 6;

	if (offset === 0) return null;
	if (offset === 1) return "sharp";
	if (offset === -1) return "flat";
	return null;
}

/**
 * Move a note by whole staff steps, staying inside the key.
 *
 * Diatonic rather than chromatic: one step up from E in C major is F, not F#.
 * That matches how the score reads and keeps the harmony consonant, which is
 * the property the whole project is built around.
 *
 * A note already carrying an accidental the key does not use keeps its own
 * spelling intent only insofar as the key allows; the destination letter's
 * in-key accidental wins, because the alternative is silently producing a
 * pitch outside the key the harmony was derived from.
 */
export function transposeNote(
	phrase: Phrase,
	index: number,
	steps: number,
	key: Key,
): Phrase {
	const note = phrase.notes[index];
	if (!note || steps === 0) return phrase;

	const letterIndex = LETTERS.indexOf(note.pitch);
	if (letterIndex < 0) return phrase;

	const absolute = letterIndex + steps;
	// Floor division carries the octave across the C boundary in both directions.
	const octaveShift = Math.floor(absolute / LETTERS.length);
	const nextLetter = LETTERS[((absolute % 7) + 7) % 7];
	const nextOctave = note.octave + octaveShift;

	const accidental = accidentalInKey(nextLetter, key) ?? note.accidental;

	return replaceNote(phrase, index, {
		...note,
		pitch: nextLetter,
		octave: nextOctave,
		accidental,
	});
}

/** Set a note's rhythmic value outright. */
export function setNoteValue(
	phrase: Phrase,
	index: number,
	noteValue: NoteValue,
): Phrase {
	const note = phrase.notes[index];
	if (!note || note.noteValue === noteValue) return phrase;
	return replaceNote(phrase, index, { ...note, noteValue });
}

/**
 * Step a note's value one position longer or shorter, clamped at the ends.
 *
 * Clamping rather than wrapping: a user holding the key down expects to stop
 * at a whole note, not to jump back to a sixteenth.
 */
export function stepNoteValue(
	phrase: Phrase,
	index: number,
	direction: 1 | -1,
): Phrase {
	const note = phrase.notes[index];
	if (!note) return phrase;
	const current = VALUES_LONG_TO_SHORT.indexOf(note.noteValue);
	if (current < 0) return phrase;
	const next = Math.min(
		VALUES_LONG_TO_SHORT.length - 1,
		Math.max(0, current + direction),
	);
	return setNoteValue(phrase, index, VALUES_LONG_TO_SHORT[next]);
}

/**
 * Remove a note.
 *
 * Later notes keep their beat positions rather than sliding left. A deletion
 * leaves a gap that reads as a rest, which is both musically honest and
 * predictable — reflowing the whole phrase would move notes the user did not
 * touch.
 */
export function deleteNote(phrase: Phrase, index: number): Phrase {
	if (!phrase.notes[index]) return phrase;
	return {
		...phrase,
		notes: phrase.notes.filter((_, position) => position !== index),
	};
}

/**
 * Insert a note, keeping the melody ordered by beat.
 *
 * Returns the new phrase and the index the inserted note landed at, so the
 * caller can move the selection onto it without re-searching.
 */
export function insertNote(
	phrase: Phrase,
	note: NoteEvent,
): { phrase: Phrase; index: number } {
	const notes = [...phrase.notes];
	// First note starting strictly later; insert before it to stay sorted while
	// placing a same-beat insertion after existing notes on that beat.
	let position = notes.findIndex(
		(existing) => existing.beatPosition > note.beatPosition,
	);
	if (position < 0) position = notes.length;
	notes.splice(position, 0, note);
	return { phrase: { ...phrase, notes }, index: position };
}

/**
 * Insert a copy of a note immediately after it, one of its own durations later.
 *
 * This is the keyboard "add a note here" gesture: it needs no pointer target
 * and always produces something musically sensible next to what is selected.
 */
export function duplicateNoteAfter(
	phrase: Phrase,
	index: number,
): { phrase: Phrase; index: number } {
	const note = phrase.notes[index];
	if (!note) return { phrase, index };
	return insertNote(phrase, {
		...note,
		beatPosition: note.beatPosition + NOTE_VALUE_BEATS[note.noteValue],
	});
}

/**
 * Shift a note along the timeline by whole beats, never before the start.
 *
 * Returns the note's new index as well as the phrase: moving a note re-sorts
 * the melody, so its position changes. A caller that kept the old index would
 * leave the selection pointing at a different note, and every edit after that
 * would hit the wrong one.
 */
export function moveNoteInTime(
	phrase: Phrase,
	index: number,
	beats: number,
): { phrase: Phrase; index: number } {
	const note = phrase.notes[index];
	if (!note || beats === 0) return { phrase, index };
	const beatPosition = Math.max(0, note.beatPosition + beats);
	if (beatPosition === note.beatPosition) return { phrase, index };

	const moved = { ...note, beatPosition };
	return insertNote(deleteNote(phrase, index), moved);
}

/** Replace one note, leaving every other note identical. */
function replaceNote(
	phrase: Phrase,
	index: number,
	note: NoteEvent,
): Phrase {
	return {
		...phrase,
		notes: phrase.notes.map((existing, position) =>
			position === index ? note : existing,
		),
	};
}

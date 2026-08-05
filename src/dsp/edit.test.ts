import { describe, expect, it } from "vitest";
import {
	accidentalInKey,
	deleteNote,
	duplicateNoteAfter,
	insertNote,
	moveNoteInTime,
	setNoteValue,
	stepNoteValue,
	transposeNote,
} from "./edit";
import type { Key } from "./key";
import type { NoteEvent, Phrase } from "./quantize";

const C_MAJOR: Key = { tonic: "C", accidental: null, mode: "major" };
const G_MAJOR: Key = { tonic: "G", accidental: null, mode: "major" };
const F_MAJOR: Key = { tonic: "F", accidental: null, mode: "major" };
const A_MINOR: Key = { tonic: "A", accidental: null, mode: "minor" };

function note(partial: Partial<NoteEvent> = {}): NoteEvent {
	return {
		pitch: "C",
		accidental: null,
		octave: 4,
		noteValue: "quarter",
		beatPosition: 0,
		...partial,
	};
}

function phraseOf(notes: NoteEvent[]): Phrase {
	return {
		notes,
		timeSignatureNumerator: 4,
		timeSignatureDenominator: 4,
		bpm: 90,
	};
}

/** A three-note phrase on beats 0, 1, 2. */
function trio(): Phrase {
	return phraseOf([
		note({ pitch: "C", beatPosition: 0 }),
		note({ pitch: "E", beatPosition: 1 }),
		note({ pitch: "G", beatPosition: 2 }),
	]);
}

describe("accidentalInKey", () => {
	it("keeps every letter natural in C major", () => {
		for (const letter of ["C", "D", "E", "F", "G", "A", "B"] as const)
			expect(accidentalInKey(letter, C_MAJOR)).toBeNull();
	});

	it("sharpens F in G major", () => {
		expect(accidentalInKey("F", G_MAJOR)).toBe("sharp");
		expect(accidentalInKey("C", G_MAJOR)).toBeNull();
	});

	it("flattens B in F major", () => {
		expect(accidentalInKey("B", F_MAJOR)).toBe("flat");
		expect(accidentalInKey("E", F_MAJOR)).toBeNull();
	});

	it("keeps A natural minor free of accidentals", () => {
		for (const letter of ["A", "B", "C", "D", "E", "F", "G"] as const)
			expect(accidentalInKey(letter, A_MINOR)).toBeNull();
	});
});

describe("transposeNote", () => {
	it("moves up one diatonic step", () => {
		const next = transposeNote(trio(), 0, 1, C_MAJOR);
		expect(next.notes[0]).toMatchObject({ pitch: "D", octave: 4 });
	});

	it("moves down one diatonic step", () => {
		const next = transposeNote(trio(), 1, -1, C_MAJOR);
		expect(next.notes[1]).toMatchObject({ pitch: "D", octave: 4 });
	});

	it("is diatonic, not chromatic — E up one step is F, not F sharp", () => {
		const next = transposeNote(trio(), 1, 1, C_MAJOR);
		expect(next.notes[1]).toMatchObject({ pitch: "F", accidental: null });
	});

	it("lands in key, sharpening F when the key demands it", () => {
		const next = transposeNote(phraseOf([note({ pitch: "E" })]), 0, 1, G_MAJOR);
		expect(next.notes[0]).toMatchObject({ pitch: "F", accidental: "sharp" });
	});

	it("carries the octave up across the B-to-C boundary", () => {
		const next = transposeNote(
			phraseOf([note({ pitch: "B", octave: 4 })]),
			0,
			1,
			C_MAJOR,
		);
		expect(next.notes[0]).toMatchObject({ pitch: "C", octave: 5 });
	});

	it("carries the octave down across the C-to-B boundary", () => {
		const next = transposeNote(
			phraseOf([note({ pitch: "C", octave: 4 })]),
			0,
			-1,
			C_MAJOR,
		);
		expect(next.notes[0]).toMatchObject({ pitch: "B", octave: 3 });
	});

	it("handles a multi-octave jump in one call", () => {
		const next = transposeNote(
			phraseOf([note({ pitch: "C", octave: 4 })]),
			0,
			14,
			C_MAJOR,
		);
		expect(next.notes[0]).toMatchObject({ pitch: "C", octave: 6 });
	});

	it("leaves every other note untouched", () => {
		const before = trio();
		const after = transposeNote(before, 0, 1, C_MAJOR);
		expect(after.notes[1]).toEqual(before.notes[1]);
		expect(after.notes[2]).toEqual(before.notes[2]);
	});

	it("preserves rhythm and position", () => {
		const after = transposeNote(trio(), 2, 2, C_MAJOR);
		expect(after.notes[2]).toMatchObject({
			beatPosition: 2,
			noteValue: "quarter",
		});
	});

	it("never mutates the input phrase", () => {
		const before = trio();
		const snapshot = structuredClone(before);
		transposeNote(before, 0, 3, C_MAJOR);
		expect(before).toEqual(snapshot);
	});

	it("returns the same phrase for a zero-step move or a bad index", () => {
		const before = trio();
		expect(transposeNote(before, 0, 0, C_MAJOR)).toBe(before);
		expect(transposeNote(before, 99, 1, C_MAJOR)).toBe(before);
		expect(transposeNote(before, -1, 1, C_MAJOR)).toBe(before);
	});
});

describe("setNoteValue and stepNoteValue", () => {
	it("sets a value outright", () => {
		expect(setNoteValue(trio(), 0, "half").notes[0].noteValue).toBe("half");
	});

	it("steps to a longer value", () => {
		expect(stepNoteValue(trio(), 0, -1).notes[0].noteValue).toBe("half");
	});

	it("steps to a shorter value", () => {
		expect(stepNoteValue(trio(), 0, 1).notes[0].noteValue).toBe("eighth");
	});

	it("clamps at a whole note rather than wrapping", () => {
		let phrase = setNoteValue(trio(), 0, "whole");
		phrase = stepNoteValue(phrase, 0, -1);
		expect(phrase.notes[0].noteValue).toBe("whole");
	});

	it("clamps at a sixteenth rather than wrapping", () => {
		let phrase = setNoteValue(trio(), 0, "sixteenth");
		phrase = stepNoteValue(phrase, 0, 1);
		expect(phrase.notes[0].noteValue).toBe("sixteenth");
	});

	it("returns the same phrase when nothing changes", () => {
		const before = trio();
		expect(setNoteValue(before, 0, "quarter")).toBe(before);
		expect(stepNoteValue(before, 99, 1)).toBe(before);
	});

	it("never mutates the input phrase", () => {
		const before = trio();
		const snapshot = structuredClone(before);
		setNoteValue(before, 1, "whole");
		expect(before).toEqual(snapshot);
	});
});

describe("deleteNote", () => {
	it("removes the addressed note", () => {
		const after = deleteNote(trio(), 1);
		expect(after.notes.map((n) => n.pitch)).toEqual(["C", "G"]);
	});

	it("leaves the remaining notes on their original beats", () => {
		// A gap reads as a rest; reflowing would move notes the user did not touch.
		const after = deleteNote(trio(), 1);
		expect(after.notes.map((n) => n.beatPosition)).toEqual([0, 2]);
	});

	it("can empty the phrase", () => {
		let phrase = trio();
		phrase = deleteNote(phrase, 0);
		phrase = deleteNote(phrase, 0);
		phrase = deleteNote(phrase, 0);
		expect(phrase.notes).toEqual([]);
	});

	it("returns the same phrase for a bad index", () => {
		const before = trio();
		expect(deleteNote(before, 99)).toBe(before);
	});

	it("never mutates the input phrase", () => {
		const before = trio();
		const snapshot = structuredClone(before);
		deleteNote(before, 0);
		expect(before).toEqual(snapshot);
	});
});

describe("insertNote", () => {
	it("keeps the melody ordered by beat", () => {
		const { phrase, index } = insertNote(
			trio(),
			note({ pitch: "D", beatPosition: 1.5 }),
		);
		expect(phrase.notes.map((n) => n.beatPosition)).toEqual([0, 1, 1.5, 2]);
		expect(index).toBe(2);
	});

	it("appends a note past the end", () => {
		const { phrase, index } = insertNote(
			trio(),
			note({ pitch: "A", beatPosition: 9 }),
		);
		expect(index).toBe(3);
		expect(phrase.notes[3].pitch).toBe("A");
	});

	it("places a same-beat insertion after the notes already on that beat", () => {
		const { index } = insertNote(trio(), note({ pitch: "F", beatPosition: 1 }));
		expect(index).toBe(2);
	});

	it("inserts before everything when the beat precedes the phrase", () => {
		const { phrase, index } = insertNote(
			phraseOf([note({ beatPosition: 4 })]),
			note({ pitch: "A", beatPosition: 0 }),
		);
		expect(index).toBe(0);
		expect(phrase.notes[0].pitch).toBe("A");
	});

	it("never mutates the input phrase", () => {
		const before = trio();
		const snapshot = structuredClone(before);
		insertNote(before, note({ beatPosition: 5 }));
		expect(before).toEqual(snapshot);
	});
});

describe("duplicateNoteAfter", () => {
	it("places a copy one of its own durations later", () => {
		// C@0 is a quarter, so the copy lands on beat 1 — where E already sits.
		// Per the insert rule a same-beat note goes after the ones already there,
		// so the returned index is what points at the copy, not an assumed slot.
		const { phrase, index } = duplicateNoteAfter(trio(), 0);
		expect(phrase.notes[index]).toMatchObject({ pitch: "C", beatPosition: 1 });
		expect(phrase.notes.map((n) => n.beatPosition)).toEqual([0, 1, 1, 2]);
	});

	it("copies the note's value and pitch", () => {
		const source = phraseOf([note({ pitch: "A", noteValue: "half", octave: 5 })]);
		const { phrase } = duplicateNoteAfter(source, 0);
		expect(phrase.notes[1]).toMatchObject({
			pitch: "A",
			octave: 5,
			noteValue: "half",
			beatPosition: 2,
		});
	});

	it("returns the phrase unchanged for a bad index", () => {
		const before = trio();
		expect(duplicateNoteAfter(before, 99).phrase).toBe(before);
	});
});

describe("moveNoteInTime", () => {
	it("shifts a note later and keeps the melody ordered", () => {
		const { phrase } = moveNoteInTime(trio(), 0, 5);
		expect(phrase.notes.map((n) => n.beatPosition)).toEqual([1, 2, 5]);
		expect(phrase.notes[2].pitch).toBe("C");
	});

	it("shifts a note earlier", () => {
		// G lands on beat 0 alongside C, and a same-beat note sorts after the one
		// already there, so the melody reads C G E.
		const { phrase } = moveNoteInTime(trio(), 2, -2);
		expect(phrase.notes.map((n) => n.pitch)).toEqual(["C", "G", "E"]);
		expect(phrase.notes.map((n) => n.beatPosition)).toEqual([0, 0, 1]);
	});

	it("reports where the moved note ended up", () => {
		// Moving re-sorts the melody. A caller that kept the old index would be
		// pointing at a different note, and every later edit would hit that one.
		const moved = moveNoteInTime(trio(), 0, 5);
		expect(moved.index).toBe(2);
		expect(moved.phrase.notes[moved.index].pitch).toBe("C");

		const back = moveNoteInTime(trio(), 2, -2);
		expect(back.phrase.notes[back.index].pitch).toBe("G");
	});

	it("never moves a note before the start of the phrase", () => {
		const { phrase } = moveNoteInTime(trio(), 0, -5);
		expect(phrase.notes[0].beatPosition).toBe(0);
	});

	it("returns the same phrase and index when the move changes nothing", () => {
		const before = trio();
		expect(moveNoteInTime(before, 0, 0).phrase).toBe(before);
		expect(moveNoteInTime(before, 0, -3).phrase).toBe(before);
		expect(moveNoteInTime(before, 99, 1).phrase).toBe(before);
		expect(moveNoteInTime(before, 1, 0).index).toBe(1);
	});

	it("never mutates the input phrase", () => {
		const before = trio();
		const snapshot = structuredClone(before);
		moveNoteInTime(before, 0, 4);
		expect(before).toEqual(snapshot);
	});
});

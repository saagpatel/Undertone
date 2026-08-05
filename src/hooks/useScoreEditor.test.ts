import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { deleteNote, duplicateNoteAfter, transposeNote } from "../dsp/edit";
import type { Key } from "../dsp/key";
import type { NoteEvent, Phrase } from "../dsp/quantize";
import type { Composition } from "../storage/types";
import { useScoreEditor } from "./useScoreEditor";

const C_MAJOR: Key = { tonic: "C", accidental: null, mode: "major" };

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

function compositionOf(pitches: NoteEvent["pitch"][]): Composition {
	const phrase: Phrase = {
		notes: pitches.map((pitch, index) =>
			note({ pitch, beatPosition: index }),
		),
		timeSignatureNumerator: 4,
		timeSignatureDenominator: 4,
		bpm: 90,
	};
	return { phrase, key: C_MAJOR };
}

describe("useScoreEditor", () => {
	it("shows the base composition before any edit", () => {
		const base = compositionOf(["C", "E", "G"]);
		const { result } = renderHook(() => useScoreEditor(base));

		expect(result.current.composition).toBe(base);
		expect(result.current.isEdited).toBe(false);
		expect(result.current.canUndo).toBe(false);
	});

	it("handles having no composition at all", () => {
		const { result } = renderHook(() => useScoreEditor(null));
		expect(result.current.composition).toBeNull();
		expect(result.current.canUndo).toBe(false);
		act(() => result.current.apply((phrase) => phrase));
		expect(result.current.composition).toBeNull();
	});

	it("applies an edit and reports the score as edited", () => {
		const { result } = renderHook(() =>
			useScoreEditor(compositionOf(["C", "E", "G"])),
		);

		act(() => result.current.apply((p) => transposeNote(p, 0, 1, C_MAJOR)));

		expect(result.current.composition?.phrase.notes[0].pitch).toBe("D");
		expect(result.current.isEdited).toBe(true);
		expect(result.current.canUndo).toBe(true);
	});

	it("never mutates the base composition", () => {
		const base = compositionOf(["C", "E", "G"]);
		const snapshot = structuredClone(base);
		const { result } = renderHook(() => useScoreEditor(base));

		act(() => result.current.apply((p) => transposeNote(p, 0, 2, C_MAJOR)));

		expect(base).toEqual(snapshot);
	});

	it("re-derives the key after an edit so harmony can track the melody", () => {
		const { result } = renderHook(() =>
			useScoreEditor(compositionOf(["C", "E", "G"])),
		);

		act(() => result.current.apply((p) => transposeNote(p, 0, 1, C_MAJOR)));

		expect(result.current.composition?.key).not.toBeNull();
	});

	it("leaves the key null once every note is deleted", () => {
		const { result } = renderHook(() => useScoreEditor(compositionOf(["C"])));

		act(() => result.current.apply((p) => deleteNote(p, 0)));

		expect(result.current.composition?.phrase.notes).toEqual([]);
		expect(result.current.composition?.key).toBeNull();
	});

	it("records no history entry for an edit that changes nothing", () => {
		const { result } = renderHook(() =>
			useScoreEditor(compositionOf(["C", "E", "G"])),
		);

		act(() => result.current.apply((p) => transposeNote(p, 99, 1, C_MAJOR)));

		expect(result.current.canUndo).toBe(false);
		expect(result.current.isEdited).toBe(false);
	});

	it("undoes an edit back to the exact prior state", () => {
		const base = compositionOf(["C", "E", "G"]);
		const { result } = renderHook(() => useScoreEditor(base));

		act(() => result.current.apply((p) => transposeNote(p, 0, 1, C_MAJOR)));
		act(() => result.current.undo());

		expect(result.current.composition).toEqual(base);
		expect(result.current.isEdited).toBe(false);
		expect(result.current.canRedo).toBe(true);
	});

	it("redoes what undo took back", () => {
		const { result } = renderHook(() =>
			useScoreEditor(compositionOf(["C", "E", "G"])),
		);

		act(() => result.current.apply((p) => transposeNote(p, 0, 1, C_MAJOR)));
		act(() => result.current.undo());
		act(() => result.current.redo());

		expect(result.current.composition?.phrase.notes[0].pitch).toBe("D");
	});

	it("walks back through several edits", () => {
		const { result } = renderHook(() =>
			useScoreEditor(compositionOf(["C", "E", "G"])),
		);

		act(() => result.current.apply((p) => transposeNote(p, 0, 1, C_MAJOR)));
		act(() => result.current.apply((p) => transposeNote(p, 1, 1, C_MAJOR)));
		expect(result.current.composition?.phrase.notes.map((n) => n.pitch)).toEqual(
			["D", "F", "G"],
		);

		act(() => result.current.undo());
		expect(result.current.composition?.phrase.notes.map((n) => n.pitch)).toEqual(
			["D", "E", "G"],
		);
		act(() => result.current.undo());
		expect(result.current.composition?.phrase.notes.map((n) => n.pitch)).toEqual(
			["C", "E", "G"],
		);
	});

	it("moves the selection onto a note an edit asks for", () => {
		const { result } = renderHook(() =>
			useScoreEditor(compositionOf(["C", "E", "G"])),
		);

		act(() =>
			result.current.apply((p) => {
				const { phrase, index } = duplicateNoteAfter(p, 0);
				return { phrase, selectIndex: index };
			}),
		);

		expect(result.current.selectedIndex).not.toBeNull();
		expect(result.current.composition?.phrase.notes).toHaveLength(4);
	});

	it("clamps the selection when a deletion shortens the melody", () => {
		const { result } = renderHook(() =>
			useScoreEditor(compositionOf(["C", "E", "G"])),
		);

		act(() => result.current.select(2));
		act(() => result.current.apply((p) => deleteNote(p, 2)));

		expect(result.current.selectedIndex).toBe(1);
	});

	it("clears the selection when the melody empties", () => {
		const { result } = renderHook(() => useScoreEditor(compositionOf(["C"])));

		act(() => result.current.select(0));
		act(() => result.current.apply((p) => deleteNote(p, 0)));

		expect(result.current.selectedIndex).toBeNull();
	});

	it("moves the selection along the melody, clamped at both ends", () => {
		const { result } = renderHook(() =>
			useScoreEditor(compositionOf(["C", "E", "G"])),
		);

		act(() => result.current.moveSelection(1));
		expect(result.current.selectedIndex).toBe(0);

		act(() => result.current.moveSelection(1));
		expect(result.current.selectedIndex).toBe(1);

		act(() => result.current.moveSelection(5));
		expect(result.current.selectedIndex).toBe(2);

		act(() => result.current.moveSelection(-9));
		expect(result.current.selectedIndex).toBe(0);
	});

	it("starts from the last note when moving backwards with nothing selected", () => {
		const { result } = renderHook(() =>
			useScoreEditor(compositionOf(["C", "E", "G"])),
		);

		act(() => result.current.moveSelection(-1));
		expect(result.current.selectedIndex).toBe(2);
	});

	it("resets the edit session when a different composition arrives", () => {
		// Undo must never cross into a different piece of music.
		const first = compositionOf(["C", "E", "G"]);
		const second = compositionOf(["F", "A"]);
		const { result, rerender } = renderHook(
			({ base }: { base: Composition | null }) => useScoreEditor(base),
			{ initialProps: { base: first as Composition | null } },
		);

		act(() => result.current.select(1));
		act(() => result.current.apply((p) => transposeNote(p, 0, 1, C_MAJOR)));
		expect(result.current.canUndo).toBe(true);

		rerender({ base: second });

		expect(result.current.composition).toBe(second);
		expect(result.current.canUndo).toBe(false);
		expect(result.current.isEdited).toBe(false);
		expect(result.current.selectedIndex).toBeNull();
	});

	it("applies a select and an edit dispatched in the same batch, in order", () => {
		// Two arrow keys pressed quickly land in one React batch. Handlers that
		// captured the selection at render time saw it as null and dropped the
		// edit silently, so edits read the selection when they run instead.
		const { result } = renderHook(() =>
			useScoreEditor(compositionOf(["C", "E", "G"])),
		);

		act(() => {
			result.current.moveSelection(1);
			result.current.apply((phrase, index, key) =>
				index === null || key === null
					? phrase
					: transposeNote(phrase, index, 1, key),
			);
		});

		expect(result.current.selectedIndex).toBe(0);
		expect(result.current.composition?.phrase.notes[0].pitch).toBe("D");
	});

	it("applies several edits dispatched in one batch cumulatively", () => {
		const { result } = renderHook(() =>
			useScoreEditor(compositionOf(["C", "E", "G"])),
		);

		act(() => {
			result.current.select(0);
			result.current.apply((p, i, k) =>
				i === null || k === null ? p : transposeNote(p, i, 1, k),
			);
			result.current.apply((p, i, k) =>
				i === null || k === null ? p : transposeNote(p, i, 1, k),
			);
		});

		// C up two diatonic steps is E.
		expect(result.current.composition?.phrase.notes[0].pitch).toBe("E");
		expect(result.current.canUndo).toBe(true);
	});

	it("survives a caller that rebuilds the composition object every render", () => {
		// Deciding "different composition" by reference made this an infinite
		// render loop: every render produced a new object, which reset the
		// session, which re-rendered. It is decided by value for that reason.
		const { result, rerender } = renderHook(() =>
			useScoreEditor(compositionOf(["C", "E", "G"])),
		);

		act(() => result.current.apply((p) => transposeNote(p, 0, 1, C_MAJOR)));
		rerender();
		rerender();

		expect(result.current.composition?.phrase.notes[0].pitch).toBe("D");
		expect(result.current.canUndo).toBe(true);
	});

	it("keeps edits across re-renders that change nothing", () => {
		const base = compositionOf(["C", "E", "G"]);
		const { result, rerender } = renderHook(
			({ b }: { b: Composition | null }) => useScoreEditor(b),
			{ initialProps: { b: base as Composition | null } },
		);

		act(() => result.current.apply((p) => transposeNote(p, 0, 1, C_MAJOR)));
		rerender({ b: base });
		rerender({ b: base });

		expect(result.current.composition?.phrase.notes[0].pitch).toBe("D");
		expect(result.current.canUndo).toBe(true);
	});
});

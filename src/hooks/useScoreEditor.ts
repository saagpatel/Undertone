import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import {
	canRedo as historyCanRedo,
	canUndo as historyCanUndo,
	createHistory,
	current,
	push,
	redo as redoHistory,
	undo as undoHistory,
} from "../dsp/history";
import type { History } from "../dsp/history";
import { detectKey } from "../dsp/key";
import type { Key } from "../dsp/key";
import type { Phrase } from "../dsp/quantize";
import type { Composition } from "../storage/types";

/** Result of an edit: the new phrase, and optionally where selection should go. */
export interface EditResult {
	phrase: Phrase;
	/** Move the selection here (e.g. onto a freshly inserted note). */
	selectIndex?: number | null;
}

/**
 * An edit, expressed as a pure function.
 *
 * It receives the selection and key **at the moment it is applied** rather than
 * closing over them at render time. Two arrow keys pressed in quick succession
 * land in the same React batch, so a handler that captured the selection when
 * it was built would act on a stale one and silently drop the edit.
 */
export type Edit = (
	phrase: Phrase,
	selectedIndex: number | null,
	key: Key | null,
) => EditResult | Phrase;

export interface ScoreEditor {
	/** The score to display: the edited state, or the base when untouched. */
	composition: Composition | null;
	selectedIndex: number | null;
	select: (index: number | null) => void;
	/** Move the selection along the melody, clamped to its ends. */
	moveSelection: (delta: number) => void;
	/** Apply a pure edit. A no-op edit records no history entry. */
	apply: (edit: Edit) => void;
	undo: () => void;
	redo: () => void;
	canUndo: boolean;
	canRedo: boolean;
	/** True once the score differs from what was captured or loaded. */
	isEdited: boolean;
}

interface EditorState {
	history: History<Composition> | null;
	selectedIndex: number | null;
}

type EditorAction =
	| { type: "reset"; base: Composition | null }
	| { type: "select"; index: number | null }
	| { type: "moveSelection"; delta: number }
	| { type: "apply"; edit: Edit }
	| { type: "undo" }
	| { type: "redo" };

function toResult(value: EditResult | Phrase): EditResult {
	return "phrase" in value ? value : { phrase: value };
}

function noteCountOf(state: EditorState): number {
	return state.history ? current(state.history).phrase.notes.length : 0;
}

/** Keep a selection inside the melody after a deletion shortens it. */
function clampSelection(
	index: number | null,
	noteCount: number,
): number | null {
	if (index === null) return null;
	if (noteCount === 0) return null;
	return Math.min(index, noteCount - 1);
}

/**
 * All editing intent in one reducer.
 *
 * Selection and history move together, so a sequence of keypresses in a single
 * React batch is applied in order against the latest state instead of each
 * handler seeing the state as it was when the batch began.
 *
 * Pure, given that every `Edit` passed in is pure — which is the contract the
 * functions in `dsp/edit.ts` satisfy.
 */
function reducer(state: EditorState, action: EditorAction): EditorState {
	switch (action.type) {
		case "reset":
			return {
				history: action.base ? createHistory(action.base) : null,
				selectedIndex: null,
			};

		case "select":
			return {
				...state,
				selectedIndex: clampSelection(action.index, noteCountOf(state)),
			};

		case "moveSelection": {
			const noteCount = noteCountOf(state);
			if (noteCount === 0) return state;
			const from = state.selectedIndex;
			const next =
				from === null
					? action.delta > 0
						? 0
						: noteCount - 1
					: Math.min(noteCount - 1, Math.max(0, from + action.delta));
			return next === from ? state : { ...state, selectedIndex: next };
		}

		case "apply": {
			if (!state.history) return state;
			const composition = current(state.history);
			const result = toResult(
				action.edit(composition.phrase, state.selectedIndex, composition.key),
			);

			// A pure edit returns the identical phrase when it changed nothing;
			// recording that would make undo a no-op the user has to press twice.
			if (result.phrase === composition.phrase) return state;

			const history = push(state.history, {
				phrase: result.phrase,
				// Re-derive the key so the engraved harmony follows the melody.
				key: result.phrase.notes.length > 0 ? detectKey(result.phrase) : null,
			});
			const requested =
				result.selectIndex !== undefined
					? result.selectIndex
					: state.selectedIndex;

			return {
				history,
				selectedIndex: clampSelection(
					requested,
					result.phrase.notes.length,
				),
			};
		}

		case "undo":
		case "redo": {
			if (!state.history) return state;
			const history =
				action.type === "undo"
					? undoHistory(state.history)
					: redoHistory(state.history);
			if (history === state.history) return state;
			return {
				history,
				selectedIndex: clampSelection(
					state.selectedIndex,
					current(history).phrase.notes.length,
				),
			};
		}
	}
}

/**
 * Is this a genuinely different piece of music?
 *
 * Identity is the fast path and covers every real case, since capture and
 * library state are both stable React state. The value comparison behind it is
 * what makes an unstable caller merely wasteful instead of catastrophic: keying
 * the reset on identity alone turns a caller that rebuilds the object each
 * render into an infinite render loop.
 */
function isSameComposition(
	a: Composition | null,
	b: Composition | null,
): boolean {
	if (a === b) return true;
	if (a === null || b === null) return false;
	return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Hand-editing for the score on screen.
 *
 * Deliberately **downstream only**: it reads the active composition and layers
 * edits on top, never writing back into the capture or library layer. That
 * keeps the data flow one-way and means an external change — a new take, or
 * opening something from the library — is unambiguous, so the edit history
 * resets cleanly rather than letting undo cross into a different piece of music.
 *
 * The key is re-detected after every edit so the engraved harmony tracks the
 * melody, which is the whole point of editing in place.
 */
export function useScoreEditor(base: Composition | null): ScoreEditor {
	const [state, dispatch] = useReducer(reducer, base, (initial) => ({
		history: initial ? createHistory(initial) : null,
		selectedIndex: null,
	}));
	const baseRef = useRef(base);

	// A new take, or a different composition opened, starts a fresh edit session.
	useEffect(() => {
		if (isSameComposition(base, baseRef.current)) return;
		baseRef.current = base;
		dispatch({ type: "reset", base });
	}, [base]);

	const select = useCallback((index: number | null) => {
		dispatch({ type: "select", index });
	}, []);
	const moveSelection = useCallback((delta: number) => {
		dispatch({ type: "moveSelection", delta });
	}, []);
	const apply = useCallback((edit: Edit) => {
		dispatch({ type: "apply", edit });
	}, []);
	const undo = useCallback(() => dispatch({ type: "undo" }), []);
	const redo = useCallback(() => dispatch({ type: "redo" }), []);

	return useMemo(
		() => ({
			composition: state.history ? current(state.history) : base,
			selectedIndex: state.selectedIndex,
			select,
			moveSelection,
			apply,
			undo,
			redo,
			canUndo: state.history ? historyCanUndo(state.history) : false,
			canRedo: state.history ? historyCanRedo(state.history) : false,
			isEdited: state.history ? state.history.cursor > 0 : false,
		}),
		[state, base, select, moveSelection, apply, undo, redo],
	);
}

import { describe, expect, it } from "vitest";
import {
	MAX_HISTORY,
	canRedo,
	canUndo,
	createHistory,
	current,
	push,
	redo,
	undo,
} from "./history";

describe("history", () => {
	it("opens holding the initial state", () => {
		const history = createHistory("a");
		expect(current(history)).toBe("a");
		expect(canUndo(history)).toBe(false);
		expect(canRedo(history)).toBe(false);
	});

	it("moves to a pushed state", () => {
		const history = push(createHistory("a"), "b");
		expect(current(history)).toBe("b");
		expect(canUndo(history)).toBe(true);
		expect(canRedo(history)).toBe(false);
	});

	it("undo restores the prior state exactly", () => {
		const history = undo(push(createHistory("a"), "b"));
		expect(current(history)).toBe("a");
		expect(canRedo(history)).toBe(true);
	});

	it("redo re-applies what undo took back", () => {
		const history = redo(undo(push(createHistory("a"), "b")));
		expect(current(history)).toBe("b");
		expect(canRedo(history)).toBe(false);
	});

	it("walks back through several states in order", () => {
		let history = createHistory(0);
		for (const value of [1, 2, 3]) history = push(history, value);

		expect(current(history)).toBe(3);
		history = undo(history);
		expect(current(history)).toBe(2);
		history = undo(history);
		expect(current(history)).toBe(1);
		history = undo(history);
		expect(current(history)).toBe(0);
	});

	it("stops at the oldest state instead of going past it", () => {
		const history = undo(undo(undo(createHistory("a"))));
		expect(current(history)).toBe("a");
		expect(canUndo(history)).toBe(false);
	});

	it("stops at the newest state instead of going past it", () => {
		const history = redo(redo(push(createHistory("a"), "b")));
		expect(current(history)).toBe("b");
	});

	it("discards the redo branch when a new edit follows an undo", () => {
		let history = createHistory("a");
		history = push(history, "b");
		history = push(history, "c");
		history = undo(history); // back to "b"
		history = push(history, "d"); // abandons "c"

		expect(current(history)).toBe("d");
		expect(canRedo(history)).toBe(false);
		expect(history.entries).toEqual(["a", "b", "d"]);
	});

	it("caps its depth, dropping the oldest state rather than the newest", () => {
		let history = createHistory(0);
		for (let value = 1; value <= MAX_HISTORY + 20; value++)
			history = push(history, value);

		expect(history.entries).toHaveLength(MAX_HISTORY);
		expect(current(history)).toBe(MAX_HISTORY + 20);
		expect(history.entries[0]).toBe(21);
	});

	it("never mutates the history it was given", () => {
		const history = createHistory("a");
		push(history, "b");
		undo(push(history, "b"));
		expect(history.entries).toEqual(["a"]);
		expect(history.cursor).toBe(0);
	});

	it("returns the same object when a move is not possible", () => {
		const history = createHistory("a");
		expect(undo(history)).toBe(history);
		expect(redo(history)).toBe(history);
	});
});

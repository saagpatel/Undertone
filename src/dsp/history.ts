/**
 * An immutable undo/redo stack.
 *
 * Kept as a pure data structure rather than hook state so the semantics that
 * are easy to get wrong — redo being discarded by a fresh edit, the depth cap
 * trimming the oldest entry rather than the newest — are directly testable.
 */

export interface History<T> {
	/** Oldest first. Never empty: index 0 is the state the history opened with. */
	readonly entries: readonly T[];
	/** Index of the current state within `entries`. */
	readonly cursor: number;
}

/**
 * Most states retained. An edit session is a handful of keystrokes, and each
 * entry holds a whole phrase; unbounded growth buys nothing a user would use.
 */
export const MAX_HISTORY = 100;

export function createHistory<T>(initial: T): History<T> {
	return { entries: [initial], cursor: 0 };
}

export function current<T>(history: History<T>): T {
	return history.entries[history.cursor];
}

export function canUndo<T>(history: History<T>): boolean {
	return history.cursor > 0;
}

export function canRedo<T>(history: History<T>): boolean {
	return history.cursor < history.entries.length - 1;
}

/**
 * Record a new state.
 *
 * Anything ahead of the cursor is dropped: editing after undoing abandons the
 * branch you undid, which is what every editor does and what users expect.
 */
export function push<T>(history: History<T>, next: T): History<T> {
	const kept = history.entries.slice(0, history.cursor + 1);
	kept.push(next);

	// Trim from the front so the newest states survive the cap.
	const overflow = Math.max(0, kept.length - MAX_HISTORY);
	const entries = overflow > 0 ? kept.slice(overflow) : kept;

	return { entries, cursor: entries.length - 1 };
}

export function undo<T>(history: History<T>): History<T> {
	return canUndo(history) ? { ...history, cursor: history.cursor - 1 } : history;
}

export function redo<T>(history: History<T>): History<T> {
	return canRedo(history) ? { ...history, cursor: history.cursor + 1 } : history;
}

import type { Key } from "../dsp/key";
import type { Phrase } from "../dsp/quantize";

/**
 * Everything needed to reconstruct a score without the microphone: the
 * quantized melody plus the key it was heard in. `key` is null for an empty
 * phrase, where detection has nothing to work from.
 */
export interface Composition {
	phrase: Phrase;
	key: Key | null;
}

/** A composition as it lives in the library, with identity and timestamps. */
export interface CompositionRecord {
	id: string;
	name: string;
	/** Epoch milliseconds. */
	createdAt: number;
	/** Epoch milliseconds; equals `createdAt` until the record is renamed. */
	updatedAt: number;
	composition: Composition;
}

/**
 * Which backing store is live. Surfaced in the UI so a user in private mode
 * understands why their library will not survive a reload.
 */
export type StoreKind = "indexeddb" | "memory";

/**
 * The composition library contract. Both the durable IndexedDB store and the
 * in-memory fallback implement it, so callers never branch on `kind` for
 * behaviour — only to explain persistence to the user.
 */
export interface CompositionStore {
	readonly kind: StoreKind;
	/** Persist a new composition and return the created record. */
	save(name: string, composition: Composition): Promise<CompositionRecord>;
	/** All records, most recently updated first. */
	list(): Promise<CompositionRecord[]>;
	/** One record by id, or null when it does not exist. */
	load(id: string): Promise<CompositionRecord | null>;
	/**
	 * Overwrite an existing record's music, keeping its id, name, and creation
	 * time. This is "save over what I opened" — the counterpart to `save`,
	 * which always creates a new record.
	 */
	update(id: string, composition: Composition): Promise<CompositionRecord>;
	/** Rename an existing record, returning the updated copy. */
	rename(id: string, name: string): Promise<CompositionRecord>;
	/** Remove a record. Deleting an unknown id is an error, not a silent no-op. */
	remove(id: string): Promise<void>;
	/** Release any underlying handles. Safe to call more than once. */
	close(): void;
}

/**
 * Base for every error this module throws. Never thrown directly.
 *
 * `underlying` carries the error that caused this one. It is a declared
 * property rather than the ES2022 `Error.cause` option because this project
 * compiles against the ES2020 lib.
 */
export class StorageError extends Error {
	readonly underlying?: unknown;

	constructor(message: string, underlying?: unknown) {
		super(message);
		this.name = "StorageError";
		this.underlying = underlying;
	}
}

/** A composition could not be encoded to, or decoded from, its wire form. */
export class CodecError extends StorageError {
	constructor(message: string, underlying?: unknown) {
		super(message, underlying);
		this.name = "CodecError";
	}
}

/** An operation named a record the store does not hold. */
export class RecordNotFoundError extends StorageError {
	constructor(readonly id: string) {
		super(`No composition with id "${id}".`);
		this.name = "RecordNotFoundError";
	}
}

/** The backing store rejected an operation (blocked upgrade, I/O). */
export class StoreUnavailableError extends StorageError {
	constructor(message: string, underlying?: unknown) {
		super(message, underlying);
		this.name = "StoreUnavailableError";
	}
}

/**
 * The browser refused a write because its storage allowance is used up.
 *
 * Distinct from {@link StoreUnavailableError} because the user can act on it —
 * delete something, or export to a file — where a generic failure leaves them
 * nothing to do.
 */
export class StorageFullError extends StorageError {
	constructor(underlying?: unknown) {
		super(
			"Your browser's storage is full. Delete a composition, or export this one to a file.",
			underlying,
		);
		this.name = "StorageFullError";
	}
}

import { MAX_NAME_LENGTH } from "./config";
import { RecordNotFoundError, StorageError } from "./types";
import type {
	Composition,
	CompositionRecord,
	CompositionStore,
	StoreKind,
} from "./types";

/**
 * Injectable environment. The defaults are the real implementations; the
 * seams exist so the contract suite can assert ordering and identity without
 * sleeping on the wall clock.
 */
export interface StoreDeps {
	now?: () => number;
	newId?: () => string;
}

/** Fallback id source for environments without `crypto.randomUUID`. */
let idCounter = 0;

export function defaultNewId(): string {
	const source = globalThis.crypto;
	if (source && typeof source.randomUUID === "function")
		return source.randomUUID();
	idCounter += 1;
	return `composition-${Date.now().toString(36)}-${idCounter}`;
}

/**
 * Normalize and validate a composition name. An empty name is a caller error
 * rather than something to paper over, because the library UI lists by name.
 */
export function normalizeName(name: string): string {
	const trimmed = name.trim();
	if (trimmed.length === 0)
		throw new StorageError("A composition name cannot be empty.");
	if (trimmed.length > MAX_NAME_LENGTH)
		throw new StorageError(
			`A composition name cannot exceed ${MAX_NAME_LENGTH} characters.`,
		);
	return trimmed;
}

/** Deep copy so stored records never alias a caller's mutable object. */
function cloneComposition(composition: Composition): Composition {
	return {
		phrase: {
			...composition.phrase,
			notes: composition.phrase.notes.map((note) => ({ ...note })),
		},
		key: composition.key === null ? null : { ...composition.key },
	};
}

function cloneRecord(record: CompositionRecord): CompositionRecord {
	return { ...record, composition: cloneComposition(record.composition) };
}

/** Most recently updated first; ties break on id so ordering is total. */
export function byMostRecentlyUpdated(
	a: CompositionRecord,
	b: CompositionRecord,
): number {
	return b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);
}

/**
 * In-memory composition library.
 *
 * This is a product requirement, not a test double: when IndexedDB is
 * unavailable (private browsing, blocked storage, an unsupported engine) the
 * library still works for the session and file export remains the durable
 * path. The UI surfaces `kind` so the user knows the difference.
 */
export class MemoryStore implements CompositionStore {
	readonly kind: StoreKind = "memory";

	private readonly records = new Map<string, CompositionRecord>();
	private readonly now: () => number;
	private readonly newId: () => string;

	constructor(deps: StoreDeps = {}) {
		this.now = deps.now ?? (() => Date.now());
		this.newId = deps.newId ?? defaultNewId;
	}

	async save(
		name: string,
		composition: Composition,
	): Promise<CompositionRecord> {
		const timestamp = this.now();
		const record: CompositionRecord = {
			id: this.newId(),
			name: normalizeName(name),
			createdAt: timestamp,
			updatedAt: timestamp,
			composition: cloneComposition(composition),
		};
		this.records.set(record.id, record);
		return cloneRecord(record);
	}

	async list(): Promise<CompositionRecord[]> {
		return [...this.records.values()]
			.sort(byMostRecentlyUpdated)
			.map(cloneRecord);
	}

	async load(id: string): Promise<CompositionRecord | null> {
		const record = this.records.get(id);
		return record ? cloneRecord(record) : null;
	}

	async update(
		id: string,
		composition: Composition,
	): Promise<CompositionRecord> {
		const record = this.records.get(id);
		if (!record) throw new RecordNotFoundError(id);
		const updated: CompositionRecord = {
			...record,
			composition: cloneComposition(composition),
			updatedAt: this.now(),
		};
		this.records.set(id, updated);
		return cloneRecord(updated);
	}

	async rename(id: string, name: string): Promise<CompositionRecord> {
		const record = this.records.get(id);
		if (!record) throw new RecordNotFoundError(id);
		const updated: CompositionRecord = {
			...record,
			name: normalizeName(name),
			updatedAt: this.now(),
		};
		this.records.set(id, updated);
		return cloneRecord(updated);
	}

	async remove(id: string): Promise<void> {
		if (!this.records.delete(id)) throw new RecordNotFoundError(id);
	}

	close(): void {
		this.records.clear();
	}
}

import { DB_NAME, DB_VERSION, STORE_NAME } from "./config";
import { byMostRecentlyUpdated, defaultNewId, normalizeName } from "./memoryStore";
import type { StoreDeps } from "./memoryStore";
import {
	RecordNotFoundError,
	StoreUnavailableError,
} from "./types";
import type {
	Composition,
	CompositionRecord,
	CompositionStore,
	StoreKind,
} from "./types";

/** Promisify an IDBRequest, preserving the underlying DOMException as the cause. */
function requestToPromise<T>(request: IDBRequest<T>, what: string): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		request.onsuccess = () => resolve(request.result);
		request.onerror = () =>
			reject(new StoreUnavailableError(`Failed to ${what}.`, request.error));
	});
}

/** Resolve once a transaction has actually committed, not merely been queued. */
function transactionToPromise(
	transaction: IDBTransaction,
	what: string,
): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		transaction.oncomplete = () => resolve();
		transaction.onabort = () =>
			reject(
				new StoreUnavailableError(
					`Transaction aborted while trying to ${what}.`,
					transaction.error,
				),
			);
		transaction.onerror = () =>
			reject(
				new StoreUnavailableError(
					`Transaction failed while trying to ${what}.`,
					transaction.error,
				),
			);
	});
}

/** True when this environment exposes a usable IndexedDB factory. */
export function isIndexedDbAvailable(): boolean {
	try {
		return typeof indexedDB !== "undefined" && indexedDB !== null;
	} catch {
		// Some engines throw on the mere property access in restricted contexts.
		return false;
	}
}

/**
 * Open the composition database, creating or upgrading the schema as needed.
 *
 * Rejects rather than hanging when the upgrade is blocked by another tab, so
 * the caller can fall back to memory instead of waiting forever.
 */
export function openDatabase(
	factory: IDBFactory = indexedDB,
	name: string = DB_NAME,
): Promise<IDBDatabase> {
	return new Promise<IDBDatabase>((resolve, reject) => {
		let request: IDBOpenDBRequest;
		try {
			request = factory.open(name, DB_VERSION);
		} catch (error) {
			reject(new StoreUnavailableError("Could not open the composition database.", error));
			return;
		}

		request.onupgradeneeded = () => {
			const db = request.result;
			// No secondary index: `list()` reads every record and sorts in memory,
			// which is the right shape for a personal library of tens of items.
			// An index on updatedAt would cost a write on every save to serve an
			// ordering the sort already provides.
			if (!db.objectStoreNames.contains(STORE_NAME))
				db.createObjectStore(STORE_NAME, { keyPath: "id" });
		};
		request.onsuccess = () => resolve(request.result);
		request.onerror = () =>
			reject(
				new StoreUnavailableError(
					"Could not open the composition database.",
					request.error,
				),
			);
		request.onblocked = () =>
			reject(
				new StoreUnavailableError(
					"The composition database upgrade is blocked by another open tab.",
				),
			);
	});
}

/**
 * Durable composition library backed by IndexedDB.
 *
 * Records are stored as plain structured-cloneable objects, so the binary
 * codec is only involved in share links and file export — the library itself
 * keeps the composition readable and inspectable in devtools.
 */
export class IndexedDbStore implements CompositionStore {
	readonly kind: StoreKind = "indexeddb";

	private readonly now: () => number;
	private readonly newId: () => string;

	constructor(
		private readonly db: IDBDatabase,
		deps: StoreDeps = {},
	) {
		this.now = deps.now ?? (() => Date.now());
		this.newId = deps.newId ?? defaultNewId;
	}

	/** Open the database and wrap it. The caller owns `close()`. */
	static async open(
		deps: StoreDeps = {},
		factory: IDBFactory = indexedDB,
		name: string = DB_NAME,
	): Promise<IndexedDbStore> {
		return new IndexedDbStore(await openDatabase(factory, name), deps);
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
			composition,
		};

		const transaction = this.db.transaction(STORE_NAME, "readwrite");
		transaction.objectStore(STORE_NAME).add(structuredClone(record));
		await transactionToPromise(transaction, `save "${record.name}"`);
		return structuredClone(record);
	}

	async list(): Promise<CompositionRecord[]> {
		const transaction = this.db.transaction(STORE_NAME, "readonly");
		const records = await requestToPromise(
			transaction.objectStore(STORE_NAME).getAll() as IDBRequest<
				CompositionRecord[]
			>,
			"list compositions",
		);
		return records.sort(byMostRecentlyUpdated);
	}

	async load(id: string): Promise<CompositionRecord | null> {
		const transaction = this.db.transaction(STORE_NAME, "readonly");
		const record = await requestToPromise(
			transaction.objectStore(STORE_NAME).get(id) as IDBRequest<
				CompositionRecord | undefined
			>,
			`load composition "${id}"`,
		);
		return record ?? null;
	}

	async rename(id: string, name: string): Promise<CompositionRecord> {
		const normalized = normalizeName(name);
		const existing = await this.load(id);
		if (!existing) throw new RecordNotFoundError(id);

		const updated: CompositionRecord = {
			...existing,
			name: normalized,
			updatedAt: this.now(),
		};

		const transaction = this.db.transaction(STORE_NAME, "readwrite");
		transaction.objectStore(STORE_NAME).put(structuredClone(updated));
		await transactionToPromise(transaction, `rename composition "${id}"`);
		return structuredClone(updated);
	}

	async remove(id: string): Promise<void> {
		const existing = await this.load(id);
		if (!existing) throw new RecordNotFoundError(id);

		const transaction = this.db.transaction(STORE_NAME, "readwrite");
		transaction.objectStore(STORE_NAME).delete(id);
		await transactionToPromise(transaction, `delete composition "${id}"`);
	}

	close(): void {
		this.db.close();
	}
}

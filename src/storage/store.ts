import { IndexedDbStore, isIndexedDbAvailable } from "./indexedDbStore";
import { MemoryStore } from "./memoryStore";
import type { StoreDeps } from "./memoryStore";
import type { CompositionStore } from "./types";

/**
 * Open the best composition library this browser can give us.
 *
 * IndexedDB is the durable path. Private browsing, blocked storage, and
 * engines that expose a broken factory all degrade to an in-memory library
 * that works for the session — the user keeps every feature except surviving
 * a reload, and `store.kind` lets the UI say so plainly.
 *
 * The fallback is never silent: the reason is logged, and the returned `kind`
 * tells the caller which path it got.
 */
export async function openCompositionStore(
	deps: StoreDeps = {},
): Promise<CompositionStore> {
	if (!isIndexedDbAvailable()) {
		console.warn(
			"Undertone: IndexedDB is unavailable; the composition library will not survive a reload. Export to a file to keep your work.",
		);
		return new MemoryStore(deps);
	}

	try {
		return await IndexedDbStore.open(deps);
	} catch (error) {
		console.warn(
			"Undertone: could not open the composition database; falling back to an in-session library. Export to a file to keep your work.",
			error,
		);
		return new MemoryStore(deps);
	}
}

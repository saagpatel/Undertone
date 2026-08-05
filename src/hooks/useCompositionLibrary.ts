import { useCallback, useEffect, useRef, useState } from "react";
import { openCompositionStore } from "../storage/store";
import { StorageError } from "../storage/types";
import type {
	Composition,
	CompositionRecord,
	CompositionStore,
	StoreKind,
} from "../storage/types";

export interface CompositionLibrary {
	records: CompositionRecord[];
	/** Null until the store has opened. */
	kind: StoreKind | null;
	isReady: boolean;
	/** Last operation failure, cleared on the next successful operation. */
	error: string | null;
	/**
	 * Mutations resolve to whether the store actually accepted the change.
	 * They never reject — the failure is reported through `error` — so callers
	 * must check the returned flag before telling the user it worked.
	 */
	save: (name: string, composition: Composition) => Promise<boolean>;
	rename: (id: string, name: string) => Promise<boolean>;
	remove: (id: string) => Promise<boolean>;
	load: (id: string) => Promise<CompositionRecord | null>;
}

function describe(error: unknown): string {
	if (error instanceof StorageError) return error.message;
	if (error instanceof Error) return error.message;
	return "The composition library hit an unexpected problem.";
}

/**
 * Owns the composition library's lifecycle for the app.
 *
 * Opens the best available store once, keeps the record list in sync after
 * every mutation, and surfaces failures as a message instead of swallowing
 * them — a save that quietly did nothing is the worst outcome for a feature
 * whose whole job is not losing your work.
 */
export function useCompositionLibrary(): CompositionLibrary {
	const storeRef = useRef<CompositionStore | null>(null);
	const [records, setRecords] = useState<CompositionRecord[]>([]);
	const [kind, setKind] = useState<StoreKind | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;

		void (async () => {
			try {
				const store = await openCompositionStore();
				if (cancelled) {
					store.close();
					return;
				}
				storeRef.current = store;
				setKind(store.kind);
				setRecords(await store.list());
			} catch (problem) {
				if (cancelled) return;
				console.error("Undertone: the composition library failed to open.", problem);
				setError(describe(problem));
			}
		})();

		return () => {
			cancelled = true;
			storeRef.current?.close();
			storeRef.current = null;
		};
	}, []);

	/** Run a store operation, refresh the list, and surface any failure. */
	const run = useCallback(
		async (
			what: string,
			operation: (store: CompositionStore) => Promise<void>,
		): Promise<boolean> => {
			const store = storeRef.current;
			if (!store) {
				setError("The composition library is not ready yet.");
				return false;
			}
			try {
				await operation(store);
				setRecords(await store.list());
				setError(null);
				return true;
			} catch (problem) {
				console.error(`Undertone: could not ${what}.`, problem);
				setError(describe(problem));
				return false;
			}
		},
		[],
	);

	const save = useCallback(
		(name: string, composition: Composition) =>
			run("save this composition", (store) =>
				store.save(name, composition).then(() => undefined),
			),
		[run],
	);

	const rename = useCallback(
		(id: string, name: string) =>
			run("rename this composition", (store) =>
				store.rename(id, name).then(() => undefined),
			),
		[run],
	);

	const remove = useCallback(
		(id: string) => run("delete this composition", (store) => store.remove(id)),
		[run],
	);

	const load = useCallback(async (id: string): Promise<CompositionRecord | null> => {
		const store = storeRef.current;
		if (!store) return null;
		try {
			const record = await store.load(id);
			setError(null);
			return record;
		} catch (problem) {
			console.error("Undertone: could not open this composition.", problem);
			setError(describe(problem));
			return null;
		}
	}, []);

	return { records, kind, isReady: kind !== null, error, save, rename, remove, load };
}

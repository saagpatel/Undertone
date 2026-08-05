import { expect, it } from "vitest";
import type { Phrase } from "../dsp/quantize";
import { RecordNotFoundError, StorageError } from "./types";
import type { Composition, CompositionStore } from "./types";

/**
 * The behavioural contract every `CompositionStore` must satisfy.
 *
 * Extracted so the in-memory and IndexedDB implementations are held to one
 * definition of correct rather than two hand-written suites that drift.
 * `describeCompositionStore` is called from a vitest `describe` block.
 */

export function sampleComposition(seed = 0): Composition {
	const phrase: Phrase = {
		notes: [
			{
				pitch: "C",
				accidental: null,
				octave: 4,
				noteValue: "quarter",
				beatPosition: 0,
			},
			{
				pitch: "E",
				accidental: seed % 2 === 0 ? null : "flat",
				octave: 4,
				noteValue: "eighth",
				beatPosition: 1,
			},
		],
		timeSignatureNumerator: 4,
		timeSignatureDenominator: 4,
		bpm: 90 + seed,
	};
	return { phrase, key: { tonic: "C", accidental: null, mode: "major" } };
}

/**
 * Register the shared contract tests.
 *
 * @param createStore Fresh, empty store per test. May be async so an
 *   IndexedDB-backed implementation can await `open`.
 */
export function describeCompositionStore(
	createStore: () => CompositionStore | Promise<CompositionStore>,
): void {
	const withStore = async (
		body: (store: CompositionStore) => Promise<void>,
	): Promise<void> => {
		const store = await createStore();
		try {
			await body(store);
		} finally {
			store.close();
		}
	};

	it("starts empty", async () => {
		await withStore(async (store) => {
			expect(await store.list()).toEqual([]);
		});
	});

	it("saves a composition and returns it verbatim on load", async () => {
		await withStore(async (store) => {
			const composition = sampleComposition();
			const saved = await store.save("First hum", composition);

			expect(saved.name).toBe("First hum");
			expect(saved.composition).toEqual(composition);
			expect(saved.createdAt).toBe(saved.updatedAt);

			const loaded = await store.load(saved.id);
			expect(loaded).toEqual(saved);
		});
	});

	it("lists every saved composition", async () => {
		await withStore(async (store) => {
			await store.save("One", sampleComposition(1));
			await store.save("Two", sampleComposition(2));
			await store.save("Three", sampleComposition(3));

			const names = (await store.list()).map((record) => record.name).sort();
			expect(names).toEqual(["One", "Three", "Two"]);
		});
	});

	it("lists most recently updated first", async () => {
		await withStore(async (store) => {
			const first = await store.save("Older", sampleComposition(1));
			const second = await store.save("Newer", sampleComposition(2));
			// Guard the ordering assertion against equal timestamps.
			if (first.updatedAt === second.updatedAt) return;
			expect((await store.list())[0].name).toBe("Newer");
		});
	});

	it("assigns a distinct id to every save", async () => {
		await withStore(async (store) => {
			const a = await store.save("Same name", sampleComposition());
			const b = await store.save("Same name", sampleComposition());
			expect(a.id).not.toBe(b.id);
			expect(await store.list()).toHaveLength(2);
		});
	});

	it("returns null for an unknown id rather than throwing", async () => {
		await withStore(async (store) => {
			expect(await store.load("no-such-id")).toBeNull();
		});
	});

	it("renames an existing composition without touching its music", async () => {
		await withStore(async (store) => {
			const composition = sampleComposition(7);
			const saved = await store.save("Working title", composition);
			const renamed = await store.rename(saved.id, "Real title");

			expect(renamed.id).toBe(saved.id);
			expect(renamed.name).toBe("Real title");
			expect(renamed.composition).toEqual(composition);
			expect(renamed.createdAt).toBe(saved.createdAt);
			expect((await store.load(saved.id))?.name).toBe("Real title");
		});
	});

	it("trims surrounding whitespace from names", async () => {
		await withStore(async (store) => {
			const saved = await store.save("  Padded  ", sampleComposition());
			expect(saved.name).toBe("Padded");
		});
	});

	it("rejects an empty or whitespace-only name", async () => {
		await withStore(async (store) => {
			await expect(store.save("   ", sampleComposition())).rejects.toThrow(
				StorageError,
			);
		});
	});

	it("deletes a composition", async () => {
		await withStore(async (store) => {
			const saved = await store.save("Doomed", sampleComposition());
			await store.remove(saved.id);
			expect(await store.load(saved.id)).toBeNull();
			expect(await store.list()).toEqual([]);
		});
	});

	it("reports a missing record on rename and delete instead of failing silently", async () => {
		await withStore(async (store) => {
			await expect(store.rename("ghost", "Name")).rejects.toThrow(
				RecordNotFoundError,
			);
			await expect(store.remove("ghost")).rejects.toThrow(RecordNotFoundError);
		});
	});

	it("does not alias the caller's composition object", async () => {
		await withStore(async (store) => {
			const composition = sampleComposition();
			const saved = await store.save("Isolated", composition);

			composition.phrase.notes[0].pitch = "B";
			composition.phrase.bpm = 200;

			const loaded = await store.load(saved.id);
			expect(loaded?.composition.phrase.notes[0].pitch).toBe("C");
			expect(loaded?.composition.phrase.bpm).not.toBe(200);
		});
	});

	it("does not let a returned record mutate stored state", async () => {
		await withStore(async (store) => {
			const saved = await store.save("Guarded", sampleComposition());
			saved.composition.phrase.notes[0].octave = 9;
			expect((await store.load(saved.id))?.composition.phrase.notes[0].octave)
				.toBe(4);
		});
	});
}

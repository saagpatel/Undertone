import { describe, expect, it } from "vitest";
import { MemoryStore } from "./memoryStore";
import { describeCompositionStore, sampleComposition } from "./storeContract";
import { StorageError } from "./types";

describe("MemoryStore", () => {
	describeCompositionStore(() => new MemoryStore());

	it("reports its kind so the UI can explain non-durable storage", () => {
		expect(new MemoryStore().kind).toBe("memory");
	});

	it("orders the list by the injected clock", async () => {
		let tick = 0;
		const store = new MemoryStore({
			now: () => ++tick,
			newId: () => `id-${tick}`,
		});

		await store.save("First", sampleComposition(1));
		await store.save("Second", sampleComposition(2));
		await store.save("Third", sampleComposition(3));

		expect((await store.list()).map((record) => record.name)).toEqual([
			"Third",
			"Second",
			"First",
		]);
	});

	it("moves a renamed composition to the front of the list", async () => {
		let tick = 0;
		const store = new MemoryStore({
			now: () => ++tick,
			newId: () => `id-${tick}`,
		});

		const first = await store.save("First", sampleComposition(1));
		await store.save("Second", sampleComposition(2));
		await store.rename(first.id, "First, renamed");

		expect((await store.list())[0].name).toBe("First, renamed");
	});

	it("rejects a name longer than the configured maximum", async () => {
		const store = new MemoryStore();
		await expect(
			store.save("x".repeat(500), sampleComposition()),
		).rejects.toThrow(StorageError);
	});

	it("drops its records on close", async () => {
		const store = new MemoryStore();
		await store.save("Ephemeral", sampleComposition());
		store.close();
		expect(await store.list()).toEqual([]);
	});
});

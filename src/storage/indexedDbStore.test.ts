import { describe, expect, it } from "vitest";
import { isIndexedDbAvailable, toStoreError } from "./indexedDbStore";
import { StorageFullError, StoreUnavailableError } from "./types";

/**
 * The IndexedDB store's behaviour is proven against real IndexedDB in
 * `scripts/prove-browser.py`, because jsdom has none. What is unit-testable
 * here is the error classification, which decides whether the user gets a
 * message they can act on.
 */
describe("toStoreError", () => {
	it("maps a quota failure to an actionable storage-full error", () => {
		const quota = new DOMException("out of room", "QuotaExceededError");
		const mapped = toStoreError(quota, "save");

		expect(mapped).toBeInstanceOf(StorageFullError);
		expect(mapped.message).toMatch(/storage is full/i);
		expect(mapped.message).toMatch(/delete|export/i);
		expect(mapped.underlying).toBe(quota);
	});

	it("maps any other DOMException to a generic store failure", () => {
		const failure = new DOMException("nope", "InvalidStateError");
		const mapped = toStoreError(failure, "save a composition");

		expect(mapped).toBeInstanceOf(StoreUnavailableError);
		expect(mapped).not.toBeInstanceOf(StorageFullError);
		expect(mapped.message).toContain("save a composition");
	});

	it("survives a null error, which IndexedDB does hand back", () => {
		const mapped = toStoreError(null, "list compositions");
		expect(mapped).toBeInstanceOf(StoreUnavailableError);
		expect(mapped.message).toContain("list compositions");
	});

	it("survives an error-like value that is not a DOMException", () => {
		expect(toStoreError({ name: "QuotaExceededError" }, "save")).toBeInstanceOf(
			StorageFullError,
		);
		expect(toStoreError("a string", "save")).toBeInstanceOf(
			StoreUnavailableError,
		);
	});
});

describe("isIndexedDbAvailable", () => {
	it("reports false under jsdom, which ships no IndexedDB", () => {
		expect(isIndexedDbAvailable()).toBe(false);
	});
});

import { describe, expect, it } from "vitest";
import { FILE_FORMAT_VERSION, FILE_MIME_TYPE } from "./config";
import { exportComposition, importComposition, toFilename } from "./file";
import { sampleComposition } from "./storeContract";
import { CodecError, StorageError } from "./types";

const EXPORTED_AT = 1_754_000_000_000;

describe("toFilename", () => {
	it("slugifies a name", () => {
		expect(toFilename("Morning Hum")).toBe("morning-hum.json");
	});

	it("collapses punctuation and trims separators", () => {
		expect(toFilename("  ***Take 2!! ***  ")).toBe("take-2.json");
	});

	it("falls back to a default when the name has no usable characters", () => {
		expect(toFilename("!!!")).toBe("untitled.json");
	});
});

describe("exportComposition", () => {
	it("produces a JSON envelope with a packed score", () => {
		const file = exportComposition("Morning Hum", sampleComposition(), EXPORTED_AT);

		expect(file.filename).toBe("morning-hum.json");
		expect(file.mimeType).toBe(FILE_MIME_TYPE);

		const parsed = JSON.parse(file.contents);
		expect(parsed.format).toBe("undertone-composition");
		expect(parsed.version).toBe(FILE_FORMAT_VERSION);
		expect(parsed.name).toBe("Morning Hum");
		expect(parsed.exportedAt).toBe(EXPORTED_AT);
		expect(typeof parsed.score).toBe("string");
	});

	it("rejects an empty name rather than writing an unnamed file", () => {
		expect(() => exportComposition("   ", sampleComposition(), EXPORTED_AT))
			.toThrow(StorageError);
	});
});

describe("importComposition", () => {
	it("round-trips an exported file exactly", () => {
		const composition = sampleComposition(5);
		const file = exportComposition("Take Two", composition, EXPORTED_AT);
		const imported = importComposition(file.contents);

		expect(imported.name).toBe("Take Two");
		expect(imported.composition).toEqual(composition);
	});

	it("rejects invalid JSON", () => {
		expect(() => importComposition("{not json")).toThrow(/valid JSON/i);
	});

	it("rejects JSON that is not an object", () => {
		expect(() => importComposition('"a string"')).toThrow(CodecError);
		expect(() => importComposition("[1, 2, 3]")).toThrow(CodecError);
		expect(() => importComposition("null")).toThrow(CodecError);
	});

	it("rejects a file from a different application", () => {
		expect(() =>
			importComposition(JSON.stringify({ format: "something-else", score: "x" })),
		).toThrow(/does not contain an Undertone composition/i);
	});

	it("rejects an unsupported file version", () => {
		const file = exportComposition("Take", sampleComposition(), EXPORTED_AT);
		const bumped = { ...JSON.parse(file.contents), version: 99 };
		expect(() => importComposition(JSON.stringify(bumped))).toThrow(/version/i);
	});

	it("rejects a file with a missing or non-string score", () => {
		const base = {
			format: "undertone-composition",
			version: FILE_FORMAT_VERSION,
			name: "x",
		};
		expect(() => importComposition(JSON.stringify(base))).toThrow(/score/i);
		expect(() => importComposition(JSON.stringify({ ...base, score: 42 })))
			.toThrow(/score/i);
	});

	it("rejects a corrupt score rather than importing an empty phrase", () => {
		const file = exportComposition("Take", sampleComposition(), EXPORTED_AT);
		const corrupted = { ...JSON.parse(file.contents), score: "!!!!" };
		expect(() => importComposition(JSON.stringify(corrupted))).toThrow(CodecError);
	});

	it("falls back to a default name when the file has none", () => {
		const file = exportComposition("Take", sampleComposition(), EXPORTED_AT);
		const unnamed = { ...JSON.parse(file.contents), name: "  " };
		expect(importComposition(JSON.stringify(unnamed)).name).toBe("Untitled");
	});
});

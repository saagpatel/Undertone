import { decodeComposition, encodeComposition } from "./codec";
import {
	DEFAULT_COMPOSITION_NAME,
	FILE_EXTENSION,
	FILE_FORMAT_VERSION,
	FILE_MIME_TYPE,
} from "./config";
import { normalizeName } from "./memoryStore";
import { CodecError } from "./types";
import type { Composition } from "./types";

/**
 * JSON file import/export.
 *
 * The envelope is readable JSON so a saved file is inspectable and its origin
 * obvious, while the score itself rides the same packed codec as share links —
 * one encoding to keep correct, one set of round-trip guarantees.
 */
export interface CompositionFile {
	format: "undertone-composition";
	version: number;
	name: string;
	/** Epoch milliseconds at export time. */
	exportedAt: number;
	/** Base64url payload produced by the composition codec. */
	score: string;
}

/** A file's contents plus the filename it should be offered under. */
export interface ExportedFile {
	filename: string;
	contents: string;
	mimeType: string;
}

/** Reduce a composition name to something safe for a filesystem. */
export function toFilename(name: string): string {
	const slug = name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return `${slug || DEFAULT_COMPOSITION_NAME.toLowerCase()}.${FILE_EXTENSION}`;
}

/** Serialize a composition to its on-disk JSON form. */
export function exportComposition(
	name: string,
	composition: Composition,
	exportedAt: number,
): ExportedFile {
	const payload: CompositionFile = {
		format: "undertone-composition",
		version: FILE_FORMAT_VERSION,
		name: normalizeName(name),
		exportedAt,
		score: encodeComposition(composition),
	};
	return {
		filename: toFilename(payload.name),
		contents: `${JSON.stringify(payload, null, "\t")}\n`,
		mimeType: FILE_MIME_TYPE,
	};
}

function asRecord(value: unknown): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		throw new CodecError("This file does not contain an Undertone composition.");
	return value as Record<string, unknown>;
}

/**
 * Parse a composition file.
 *
 * Every field is narrowed from `unknown` before use; anything unexpected
 * throws a CodecError so a wrong file never half-loads.
 */
export function importComposition(contents: string): {
	name: string;
	composition: Composition;
} {
	let parsed: unknown;
	try {
		parsed = JSON.parse(contents);
	} catch (error) {
		throw new CodecError("This file is not valid JSON.", error);
	}

	const record = asRecord(parsed);

	if (record.format !== "undertone-composition")
		throw new CodecError("This file does not contain an Undertone composition.");

	if (record.version !== FILE_FORMAT_VERSION)
		throw new CodecError(
			`Unsupported composition file version ${String(record.version)}; this build reads version ${FILE_FORMAT_VERSION}.`,
		);

	if (typeof record.score !== "string")
		throw new CodecError("This composition file is missing its score.");

	const name =
		typeof record.name === "string" && record.name.trim().length > 0
			? record.name.trim()
			: DEFAULT_COMPOSITION_NAME;

	return { name, composition: decodeComposition(record.score) };
}

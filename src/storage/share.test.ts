import { describe, expect, it } from "vitest";
import { encodeComposition } from "./codec";
import { MAX_SHARE_URL_LENGTH, SHARE_HASH_KEY } from "./config";
import { buildShareLink, readSharedPayload, restoreFromHash } from "./share";
import { sampleComposition } from "./storeContract";
import { CodecError } from "./types";
import type { Composition } from "./types";

const BASE_URL = "https://undertone.example/app";

function longComposition(noteCount: number): Composition {
	const base = sampleComposition();
	return {
		...base,
		phrase: {
			...base.phrase,
			notes: Array.from({ length: noteCount }, (_, i) => ({
				pitch: "C" as const,
				accidental: null,
				octave: 4,
				noteValue: "sixteenth" as const,
				beatPosition: i * 0.25,
			})),
		},
	};
}

describe("buildShareLink", () => {
	it("puts the score in the hash, never in the query or path", () => {
		const { url } = buildShareLink(sampleComposition(), BASE_URL);
		const parsed = new URL(url);
		expect(parsed.pathname).toBe("/app");
		expect(parsed.search).toBe("");
		expect(parsed.hash.startsWith(`#${SHARE_HASH_KEY}=`)).toBe(true);
	});

	it("preserves the base origin and path", () => {
		const { url } = buildShareLink(
			sampleComposition(),
			"https://example.test/deep/path",
		);
		const parsed = new URL(url);
		expect(parsed.origin).toBe("https://example.test");
		expect(parsed.pathname).toBe("/deep/path");
	});

	it("replaces an existing hash rather than appending to it", () => {
		const { url } = buildShareLink(
			sampleComposition(),
			`${BASE_URL}#${SHARE_HASH_KEY}=stale`,
		);
		expect(url.match(new RegExp(SHARE_HASH_KEY, "g"))).toHaveLength(1);
		expect(url).not.toContain("stale");
	});

	it("reports a realistic phrase as within the length limit", () => {
		const link = buildShareLink(longComposition(64), BASE_URL);
		expect(link.withinLengthLimit).toBe(true);
		expect(link.length).toBeLessThanOrEqual(MAX_SHARE_URL_LENGTH);
	});

	it("flags an over-long link instead of emitting a silently broken URL", () => {
		const link = buildShareLink(longComposition(3000), BASE_URL);
		expect(link.length).toBeGreaterThan(MAX_SHARE_URL_LENGTH);
		expect(link.withinLengthLimit).toBe(false);
	});
});

describe("readSharedPayload", () => {
	it("returns null for an empty hash", () => {
		expect(readSharedPayload("")).toBeNull();
		expect(readSharedPayload("#")).toBeNull();
	});

	it("returns null when the hash carries no score key", () => {
		expect(readSharedPayload("#other=value")).toBeNull();
	});

	it("reads the payload with or without a leading hash", () => {
		const encoded = encodeComposition(sampleComposition());
		expect(readSharedPayload(`#${SHARE_HASH_KEY}=${encoded}`)).toBe(encoded);
		expect(readSharedPayload(`${SHARE_HASH_KEY}=${encoded}`)).toBe(encoded);
	});

	it("finds the score alongside other hash parameters", () => {
		const encoded = encodeComposition(sampleComposition());
		expect(readSharedPayload(`#a=1&${SHARE_HASH_KEY}=${encoded}&b=2`)).toBe(
			encoded,
		);
	});
});

describe("restoreFromHash", () => {
	it("round-trips a composition through a share link", () => {
		const composition = sampleComposition(3);
		const { url } = buildShareLink(composition, BASE_URL);
		const restored = restoreFromHash(new URL(url).hash);
		expect(restored).toEqual(composition);
	});

	it("returns null on a cold load with no score", () => {
		expect(restoreFromHash("")).toBeNull();
		expect(restoreFromHash("#nothing=here")).toBeNull();
	});

	it("throws on a corrupt score rather than reporting an empty one", () => {
		expect(() => restoreFromHash(`#${SHARE_HASH_KEY}=!!!not-base64!!!`)).toThrow(
			CodecError,
		);
	});

	it("throws on a truncated score rather than restoring a partial phrase", () => {
		const encoded = encodeComposition(longComposition(16));
		const truncated = encoded.slice(0, encoded.length - 4);
		expect(() => restoreFromHash(`#${SHARE_HASH_KEY}=${truncated}`)).toThrow(
			CodecError,
		);
	});
});

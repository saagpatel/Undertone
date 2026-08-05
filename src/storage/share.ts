import { decodeComposition, encodeComposition } from "./codec";
import { MAX_SHARE_URL_LENGTH, SHARE_HASH_KEY } from "./config";
import { CodecError } from "./types";
import type { Composition } from "./types";

/**
 * Share links.
 *
 * A composition travels in `location.hash`, which browsers never send to a
 * server. That is what keeps sharing consistent with the project's local-only
 * rule: opening a share link performs zero network requests beyond fetching
 * the app itself.
 */

/** Outcome of building a share link, including whether it is safely sendable. */
export interface ShareLink {
	url: string;
	/** False when the URL exceeds what browsers and chat clients handle intact. */
	withinLengthLimit: boolean;
	length: number;
}

/** Build the share URL for a composition, relative to a base page URL. */
export function buildShareLink(
	composition: Composition,
	baseUrl: string,
): ShareLink {
	const encoded = encodeComposition(composition);
	const url = new URL(baseUrl);
	url.hash = `${SHARE_HASH_KEY}=${encoded}`;
	const href = url.toString();
	return {
		url: href,
		withinLengthLimit: href.length <= MAX_SHARE_URL_LENGTH,
		length: href.length,
	};
}

/**
 * Read the encoded composition out of a hash fragment.
 *
 * Returns null when the hash simply carries no score — that is the ordinary
 * cold-load case, not an error.
 */
export function readSharedPayload(hash: string): string | null {
	const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
	if (fragment.length === 0) return null;
	const params = new URLSearchParams(fragment);
	const payload = params.get(SHARE_HASH_KEY);
	return payload && payload.length > 0 ? payload : null;
}

/**
 * Restore a composition from a hash fragment.
 *
 * Null means "no score in this URL". A malformed score throws a CodecError —
 * a corrupt link must not look like an empty one, because the two call for
 * different messages in the UI.
 */
export function restoreFromHash(hash: string): Composition | null {
	const payload = readSharedPayload(hash);
	if (payload === null) return null;
	try {
		return decodeComposition(payload);
	} catch (error) {
		if (error instanceof CodecError) throw error;
		throw new CodecError("Could not read the score in this link.", error);
	}
}

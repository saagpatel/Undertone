/**
 * Phase 10 persistence configuration.
 *
 * Every environment-specific or tunable value for the composition library,
 * codec, and share link lives here — nothing downstream hardcodes a database
 * name, a store name, a URL key, or a size limit.
 */

/** IndexedDB database holding the composition library. */
export const DB_NAME = "undertone";

/**
 * IndexedDB schema version. Bump only alongside a migration in
 * `indexedDbStore.ts`'s `upgradeneeded` handler.
 */
export const DB_VERSION = 1;

/** Object store holding one record per saved composition. */
export const STORE_NAME = "compositions";

/** Index over `updatedAt` so `list()` can read in most-recent-first order. */
export const UPDATED_AT_INDEX = "updatedAt";

/**
 * Codec format version, written as the first byte of every encoded payload.
 * A decoder that meets an unknown version throws rather than guessing.
 */
export const CODEC_VERSION = 1;

/**
 * Beat-grid resolution used by the codec: `beatPosition` is stored as an
 * integer number of 1/16-beat steps. `quantizePhrase` emits positions on a
 * 1/4-beat grid, so this carries the producer's output exactly with headroom.
 */
export const BEAT_STEPS_PER_BEAT = 16;

/**
 * Tempo resolution: bpm is stored as an integer number of hundredths, so
 * fractional tempos round-trip exactly.
 */
export const BPM_SCALE = 100;

/**
 * Encodable octave range. `frequencyToPitch` derives the octave from a MIDI
 * number, which cannot leave 0-9 for any audible pitch. Anything outside this
 * is corrupt data, and the codec rejects it rather than round-tripping a note
 * that cannot exist.
 */
export const MIN_OCTAVE = 0;
export const MAX_OCTAVE = 9;

/** `location.hash` key carrying an encoded composition on a share link. */
export const SHARE_HASH_KEY = "score";

/**
 * Practical ceiling for a shareable URL. Browsers and chat clients start
 * truncating well before the theoretical limit; past this the UI directs the
 * user to file export instead of silently producing a broken link.
 */
export const MAX_SHARE_URL_LENGTH = 2000;

/** Longest accepted composition name, enforced on save and rename. */
export const MAX_NAME_LENGTH = 120;

/** Name applied when a composition is saved without one. */
export const DEFAULT_COMPOSITION_NAME = "Untitled";

/** File extension and MIME type for JSON composition export/import. */
export const FILE_EXTENSION = "json";
export const FILE_MIME_TYPE = "application/json";

/** Envelope version for the JSON file format (independent of the binary codec). */
export const FILE_FORMAT_VERSION = 1;

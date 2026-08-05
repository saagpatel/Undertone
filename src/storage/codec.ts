import type { Key, Mode } from "../dsp/key";
import type {
	Accidental,
	NoteEvent,
	NoteName,
	NoteValue,
} from "../dsp/quantize";
import {
	BEAT_STEPS_PER_BEAT,
	BPM_SCALE,
	CODEC_VERSION,
	MAX_OCTAVE,
	MIN_OCTAVE,
} from "./config";
import { CodecError } from "./types";
import type { Composition } from "./types";

/**
 * Binary composition codec.
 *
 * A composition goes into a share link, so JSON is not an option: a 32-note
 * phrase serializes to roughly 2.5 KB of JSON, which blows past any practical
 * URL budget once base64-encoded. Packed, the same phrase costs about 135
 * bytes. The packing is what makes share links viable, not an optimisation.
 *
 * Layout (all multi-byte integers are unsigned LEB128 varints):
 *
 *   u8      format version
 *   varint  tempo, in hundredths of a BPM
 *   u8      time signature numerator
 *   u8      time signature denominator
 *   u8      key: present(1b) | mode(1b) | accidental(2b) | tonic(3b)
 *   varint  note count
 *   per note:
 *     u8      pitch(3b) | accidental(2b) | noteValue(3b)
 *     u8      octave
 *     varint  beat position, in 1/16-beat steps
 *
 * Decoding is strict in both directions: an unknown version, a truncated
 * buffer, or unconsumed trailing bytes all throw rather than yielding a
 * partial composition.
 */

const PITCHES: readonly NoteName[] = ["C", "D", "E", "F", "G", "A", "B"];
const ACCIDENTALS: readonly Accidental[] = [null, "sharp", "flat"];
const NOTE_VALUES: readonly NoteValue[] = [
	"whole",
	"half",
	"quarter",
	"eighth",
	"sixteenth",
];
const MODES: readonly Mode[] = ["major", "minor"];

function indexOrThrow<T>(table: readonly T[], value: T, label: string): number {
	const index = table.indexOf(value);
	if (index < 0) throw new CodecError(`Unknown ${label}: ${String(value)}.`);
	return index;
}

function itemOrThrow<T>(table: readonly T[], index: number, label: string): T {
	const item = table[index];
	if (item === undefined)
		throw new CodecError(`Unknown ${label} code: ${index}.`);
	return item;
}

/**
 * Guard the octave in both directions: an out-of-range value on the way in is
 * corrupt caller data, and on the way out it is a corrupt payload. Either way
 * it describes a note that cannot exist, so it must not round-trip.
 */
function assertOctave(octave: number): number {
	if (!Number.isInteger(octave) || octave < MIN_OCTAVE || octave > MAX_OCTAVE)
		throw new CodecError(
			`octave must be an integer ${MIN_OCTAVE}-${MAX_OCTAVE}, got ${octave}.`,
		);
	return octave;
}

/** Convert a beat position to whole 1/16-beat steps, refusing off-grid values. */
function beatsToSteps(beatPosition: number): number {
	if (!Number.isFinite(beatPosition) || beatPosition < 0)
		throw new CodecError(
			`Beat position must be a non-negative finite number, got ${beatPosition}.`,
		);
	const steps = beatPosition * BEAT_STEPS_PER_BEAT;
	const rounded = Math.round(steps);
	// Float arithmetic on musical fractions lands within a whisker of the grid;
	// anything further off is a genuinely unrepresentable position.
	if (Math.abs(steps - rounded) > 1e-6)
		throw new CodecError(
			`Beat position ${beatPosition} is off the 1/${BEAT_STEPS_PER_BEAT}-beat grid.`,
		);
	return rounded;
}

class ByteWriter {
	private readonly bytes: number[] = [];

	u8(value: number, label: string): void {
		if (!Number.isInteger(value) || value < 0 || value > 255)
			throw new CodecError(`${label} must be an integer 0-255, got ${value}.`);
		this.bytes.push(value);
	}

	varint(value: number, label: string): void {
		if (!Number.isInteger(value) || value < 0)
			throw new CodecError(
				`${label} must be a non-negative integer, got ${value}.`,
			);
		let remaining = value;
		while (remaining >= 0x80) {
			this.bytes.push((remaining & 0x7f) | 0x80);
			remaining = Math.floor(remaining / 0x80);
		}
		this.bytes.push(remaining);
	}

	toUint8Array(): Uint8Array {
		return Uint8Array.from(this.bytes);
	}
}

class ByteReader {
	private cursor = 0;

	constructor(private readonly bytes: Uint8Array) {}

	u8(label: string): number {
		if (this.cursor >= this.bytes.length)
			throw new CodecError(`Payload truncated while reading ${label}.`);
		return this.bytes[this.cursor++];
	}

	varint(label: string): number {
		let result = 0;
		let scale = 1;
		for (;;) {
			const byte = this.u8(label);
			result += (byte & 0x7f) * scale;
			if ((byte & 0x80) === 0) return result;
			scale *= 0x80;
			if (scale > Number.MAX_SAFE_INTEGER)
				throw new CodecError(`Varint for ${label} is too large to represent.`);
		}
	}

	assertFullyConsumed(): void {
		if (this.cursor !== this.bytes.length)
			throw new CodecError(
				`Payload has ${this.bytes.length - this.cursor} trailing byte(s) after a complete composition.`,
			);
	}
}

function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
	if (text.length === 0) throw new CodecError("Encoded composition is empty.");
	if (!/^[A-Za-z0-9_-]+$/.test(text))
		throw new CodecError(
			"Encoded composition contains characters outside the base64url alphabet.",
		);
	try {
		const binary = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
		return Uint8Array.from(binary, (character) => character.charCodeAt(0));
	} catch (error) {
		throw new CodecError("Encoded composition is not valid base64url.", error);
	}
}

function packKey(key: Key | null): number {
	if (key === null) return 0;
	const tonic = indexOrThrow(PITCHES, key.tonic, "tonic");
	const accidental = indexOrThrow(ACCIDENTALS, key.accidental, "key accidental");
	const mode = indexOrThrow(MODES, key.mode, "mode");
	return 0x80 | (mode << 5) | (accidental << 3) | tonic;
}

function unpackKey(byte: number): Key | null {
	if ((byte & 0x80) === 0) return null;
	return {
		mode: itemOrThrow(MODES, (byte >> 5) & 0x01, "mode"),
		accidental: itemOrThrow(ACCIDENTALS, (byte >> 3) & 0x03, "key accidental"),
		tonic: itemOrThrow(PITCHES, byte & 0x07, "tonic"),
	};
}

/** Encode a composition to a compact, URL-safe string. */
export function encodeComposition(composition: Composition): string {
	const { phrase, key } = composition;
	const writer = new ByteWriter();

	writer.u8(CODEC_VERSION, "format version");

	const centiBpm = Math.round(phrase.bpm * BPM_SCALE);
	if (!Number.isFinite(phrase.bpm) || centiBpm <= 0)
		throw new CodecError(`bpm must be a positive number, got ${phrase.bpm}.`);
	writer.varint(centiBpm, "bpm");

	for (const [label, value] of [
		["time signature numerator", phrase.timeSignatureNumerator],
		["time signature denominator", phrase.timeSignatureDenominator],
	] as const) {
		if (!Number.isInteger(value) || value < 1 || value > 255)
			throw new CodecError(`${label} must be an integer 1-255, got ${value}.`);
		writer.u8(value, label);
	}

	writer.u8(packKey(key), "key");
	writer.varint(phrase.notes.length, "note count");

	for (const note of phrase.notes) {
		const pitch = indexOrThrow(PITCHES, note.pitch, "pitch");
		const accidental = indexOrThrow(ACCIDENTALS, note.accidental, "accidental");
		const noteValue = indexOrThrow(NOTE_VALUES, note.noteValue, "note value");
		writer.u8((pitch << 5) | (accidental << 3) | noteValue, "note");

		writer.u8(assertOctave(note.octave), "octave");
		writer.varint(beatsToSteps(note.beatPosition), "beat position");
	}

	return toBase64Url(writer.toUint8Array());
}

/** Decode a composition previously produced by {@link encodeComposition}. */
export function decodeComposition(encoded: string): Composition {
	const reader = new ByteReader(fromBase64Url(encoded));

	const version = reader.u8("format version");
	if (version !== CODEC_VERSION)
		throw new CodecError(
			`Unsupported composition format version ${version}; this build reads version ${CODEC_VERSION}.`,
		);

	const bpm = reader.varint("bpm") / BPM_SCALE;
	const timeSignatureNumerator = reader.u8("time signature numerator");
	const timeSignatureDenominator = reader.u8("time signature denominator");
	const key = unpackKey(reader.u8("key"));
	const noteCount = reader.varint("note count");

	const notes: NoteEvent[] = [];
	for (let index = 0; index < noteCount; index++) {
		const packed = reader.u8("note");
		notes.push({
			pitch: itemOrThrow(PITCHES, (packed >> 5) & 0x07, "pitch"),
			accidental: itemOrThrow(ACCIDENTALS, (packed >> 3) & 0x03, "accidental"),
			noteValue: itemOrThrow(NOTE_VALUES, packed & 0x07, "note value"),
			octave: assertOctave(reader.u8("octave")),
			beatPosition: reader.varint("beat position") / BEAT_STEPS_PER_BEAT,
		});
	}

	reader.assertFullyConsumed();

	return {
		phrase: {
			notes,
			timeSignatureNumerator,
			timeSignatureDenominator,
			bpm,
		},
		key,
	};
}

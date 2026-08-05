import { describe, expect, it } from "vitest";
import type { Key } from "../dsp/key";
import type {
	Accidental,
	NoteEvent,
	NoteName,
	NoteValue,
	Phrase,
} from "../dsp/quantize";
import { NOTE_VALUE_BEATS, quantizePhrase } from "../dsp/quantize";
import { decodeComposition, encodeComposition } from "./codec";
import { BEAT_STEPS_PER_BEAT, CODEC_VERSION } from "./config";
import { CodecError } from "./types";
import type { Composition } from "./types";

const NOTE_NAMES: NoteName[] = ["C", "D", "E", "F", "G", "A", "B"];
const ACCIDENTALS: Accidental[] = ["sharp", "flat", null];
const NOTE_VALUES: NoteValue[] = [
	"whole",
	"half",
	"quarter",
	"eighth",
	"sixteenth",
];

function note(partial: Partial<NoteEvent> = {}): NoteEvent {
	return {
		pitch: "C",
		accidental: null,
		octave: 4,
		noteValue: "quarter",
		beatPosition: 0,
		...partial,
	};
}

function phrase(notes: NoteEvent[], partial: Partial<Phrase> = {}): Phrase {
	return {
		notes,
		timeSignatureNumerator: 4,
		timeSignatureDenominator: 4,
		bpm: 90,
		...partial,
	};
}

const C_MAJOR: Key = { tonic: "C", accidental: null, mode: "major" };

describe("encodeComposition / decodeComposition", () => {
	it("round-trips an empty phrase with no key", () => {
		const input: Composition = { phrase: phrase([]), key: null };
		expect(decodeComposition(encodeComposition(input))).toEqual(input);
	});

	it("round-trips a single note exactly", () => {
		const input: Composition = {
			phrase: phrase([note({ pitch: "G", accidental: "sharp", octave: 5 })]),
			key: C_MAJOR,
		};
		expect(decodeComposition(encodeComposition(input))).toEqual(input);
	});

	it("round-trips every pitch / accidental / note-value combination", () => {
		const notes: NoteEvent[] = [];
		let beat = 0;
		for (const pitch of NOTE_NAMES)
			for (const accidental of ACCIDENTALS)
				for (const noteValue of NOTE_VALUES) {
					notes.push({
						pitch,
						accidental,
						octave: 4,
						noteValue,
						beatPosition: beat,
					});
					beat += NOTE_VALUE_BEATS[noteValue];
				}

		const input: Composition = { phrase: phrase(notes), key: C_MAJOR };
		const decoded = decodeComposition(encodeComposition(input));
		expect(decoded.phrase.notes).toHaveLength(NOTE_NAMES.length * 15);
		expect(decoded).toEqual(input);
	});

	it("round-trips every key (tonic x accidental x mode)", () => {
		for (const tonic of NOTE_NAMES)
			for (const accidental of ACCIDENTALS)
				for (const mode of ["major", "minor"] as const) {
					const input: Composition = {
						phrase: phrase([note()]),
						key: { tonic, accidental, mode },
					};
					expect(decodeComposition(encodeComposition(input)).key).toEqual({
						tonic,
						accidental,
						mode,
					});
				}
	});

	it("round-trips the full octave range the pitch detector can emit", () => {
		for (let octave = 0; octave <= 9; octave++) {
			const input: Composition = {
				phrase: phrase([note({ octave })]),
				key: null,
			};
			expect(decodeComposition(encodeComposition(input)).phrase.notes[0].octave)
				.toBe(octave);
		}
	});

	it("round-trips a fractional tempo and a non-4/4 time signature", () => {
		const input: Composition = {
			phrase: phrase([note()], {
				bpm: 132.5,
				timeSignatureNumerator: 6,
				timeSignatureDenominator: 8,
			}),
			key: null,
		};
		expect(decodeComposition(encodeComposition(input))).toEqual(input);
	});

	it("round-trips beat positions far into a long phrase", () => {
		const notes = Array.from({ length: 200 }, (_, i) =>
			note({ beatPosition: i * 0.25 }),
		);
		const decoded = decodeComposition(
			encodeComposition({ phrase: phrase(notes), key: null }),
		);
		expect(decoded.phrase.notes.map((n) => n.beatPosition)).toEqual(
			notes.map((n) => n.beatPosition),
		);
	});

	it("round-trips real quantizer output", () => {
		const raw = [
			{ frequency: 261.63, onsetMs: 1000, durationMs: 660 },
			{ frequency: 293.66, onsetMs: 1660, durationMs: 340 },
			{ frequency: 329.63, onsetMs: 2000, durationMs: 1330 },
			{ frequency: 392.0, onsetMs: 3330, durationMs: 670 },
		];
		const input: Composition = { phrase: quantizePhrase(raw), key: C_MAJOR };
		expect(decodeComposition(encodeComposition(input))).toEqual(input);
	});

	it("produces a URL-safe payload with no base64 padding or reserved characters", () => {
		const notes = Array.from({ length: 64 }, (_, i) =>
			note({ pitch: NOTE_NAMES[i % 7], beatPosition: i * 0.5 }),
		);
		const encoded = encodeComposition({ phrase: phrase(notes), key: C_MAJOR });
		expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
	});

	it("stays compact enough for a share link at realistic phrase lengths", () => {
		const notes = Array.from({ length: 64 }, (_, i) =>
			note({ pitch: NOTE_NAMES[i % 7], beatPosition: i * 0.5 }),
		);
		const encoded = encodeComposition({ phrase: phrase(notes), key: C_MAJOR });
		// A 64-note phrase is a long hum; packed it must stay far under the URL cap.
		expect(encoded.length).toBeLessThan(500);
	});
});

describe("decodeComposition rejects bad input", () => {
	it("throws CodecError on an empty string", () => {
		expect(() => decodeComposition("")).toThrow(CodecError);
	});

	it("throws CodecError on characters outside the base64url alphabet", () => {
		expect(() => decodeComposition("not valid!!")).toThrow(CodecError);
	});

	it("throws CodecError on an unknown format version", () => {
		const bytes = new Uint8Array([CODEC_VERSION + 7, 0, 0, 0, 0, 0]);
		expect(() => decodeComposition(toBase64Url(bytes))).toThrow(/version/i);
	});

	it("throws CodecError on a truncated payload rather than returning a partial", () => {
		const full = encodeComposition({
			phrase: phrase([note(), note({ beatPosition: 1 })]),
			key: C_MAJOR,
		});
		const bytes = fromBase64Url(full);
		expect(() => decodeComposition(toBase64Url(bytes.slice(0, bytes.length - 2))))
			.toThrow(CodecError);
	});

	it("throws CodecError on trailing bytes after a complete payload", () => {
		const full = encodeComposition({ phrase: phrase([note()]), key: null });
		const bytes = fromBase64Url(full);
		const extended = new Uint8Array(bytes.length + 1);
		extended.set(bytes);
		expect(() => decodeComposition(toBase64Url(extended))).toThrow(/trailing/i);
	});
});

describe("encodeComposition rejects unrepresentable input", () => {
	it("throws CodecError on a beat position off the 1/16-beat grid", () => {
		expect(() =>
			encodeComposition({
				phrase: phrase([note({ beatPosition: 1 / 3 })]),
				key: null,
			}),
		).toThrow(/grid/i);
	});

	it("throws CodecError on a negative beat position", () => {
		expect(() =>
			encodeComposition({
				phrase: phrase([note({ beatPosition: -1 })]),
				key: null,
			}),
		).toThrow(CodecError);
	});

	it("throws CodecError on an octave outside the encodable range", () => {
		expect(() =>
			encodeComposition({ phrase: phrase([note({ octave: 42 })]), key: null }),
		).toThrow(/octave/i);
	});

	it("throws CodecError on a tempo outside the encodable range", () => {
		expect(() =>
			encodeComposition({ phrase: phrase([note()], { bpm: 0 }), key: null }),
		).toThrow(/bpm/i);
	});

	it("throws CodecError rather than silently corrupting a varint past int32", () => {
		// Bitwise ops coerce to int32, so a value at or above 2^31 would encode to
		// wrong bytes that still decode cleanly. It must be refused instead.
		const overflowBeat = 2 ** 31 / BEAT_STEPS_PER_BEAT;
		expect(() =>
			encodeComposition({
				phrase: phrase([note({ beatPosition: overflowBeat })]),
				key: null,
			}),
		).toThrow(/too large to encode/i);
	});

	it("still encodes the largest representable varint", () => {
		const maxBeat = (2 ** 31 - 1 - 15) / BEAT_STEPS_PER_BEAT;
		const input: Composition = {
			phrase: phrase([note({ beatPosition: maxBeat })]),
			key: null,
		};
		expect(decodeComposition(encodeComposition(input)).phrase.notes[0].beatPosition)
			.toBe(maxBeat);
	});

	it("throws CodecError on a time signature that does not fit one byte", () => {
		expect(() =>
			encodeComposition({
				phrase: phrase([note()], { timeSignatureNumerator: 300 }),
				key: null,
			}),
		).toThrow(/time signature/i);
	});
});

// Local base64url helpers so the tests can corrupt payloads at the byte level
// without importing the codec's private internals.
function toBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
	const padded = text.replace(/-/g, "+").replace(/_/g, "/");
	const binary = atob(padded);
	return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

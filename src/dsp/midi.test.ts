import { describe, expect, it } from "vitest";
import {
	MIDI_NOTE_OFF,
	MIDI_NOTE_ON,
	MidiSession,
	type MidiNoteMessage,
	isWebMidiAvailable,
	parseMidiMessage,
	reduceMidiToPhrase,
} from "./midi";
import { SESSION_TIMEOUT_MS } from "./capture";
import { midiNoteToFrequency, quantizePhrase } from "./quantize";

const MIDDLE_C = 60;
const D4 = 62;
const E4 = 64;
const G4 = 67;

function on(note: number, timeMs: number, velocity = 100): MidiNoteMessage {
	return { kind: "on", note, velocity, timeMs };
}

function off(note: number, timeMs: number): MidiNoteMessage {
	return { kind: "off", note, velocity: 0, timeMs };
}

describe("parseMidiMessage", () => {
	it("reads a note-on across every channel", () => {
		for (let channel = 0; channel < 16; channel++) {
			const parsed = parseMidiMessage(
				Uint8Array.from([MIDI_NOTE_ON | channel, MIDDLE_C, 100]),
				1000,
			);
			expect(parsed).toEqual({
				kind: "on",
				note: MIDDLE_C,
				velocity: 100,
				timeMs: 1000,
			});
		}
	});

	it("reads a note-off across every channel", () => {
		for (let channel = 0; channel < 16; channel++) {
			const parsed = parseMidiMessage(
				Uint8Array.from([MIDI_NOTE_OFF | channel, MIDDLE_C, 0]),
				1500,
			);
			expect(parsed?.kind).toBe("off");
			expect(parsed?.note).toBe(MIDDLE_C);
		}
	});

	it("treats a note-on with velocity 0 as a note-off", () => {
		// Running-status keyboards send this instead of an explicit note-off.
		const parsed = parseMidiMessage(
			Uint8Array.from([MIDI_NOTE_ON, MIDDLE_C, 0]),
			2000,
		);
		expect(parsed?.kind).toBe("off");
	});

	it("ignores non-note messages", () => {
		// 0xB0 control change, 0xE0 pitch bend, 0xF8 clock.
		expect(parseMidiMessage(Uint8Array.from([0xb0, 7, 64]), 0)).toBeNull();
		expect(parseMidiMessage(Uint8Array.from([0xe0, 0, 64]), 0)).toBeNull();
		expect(parseMidiMessage(Uint8Array.from([0xf8]), 0)).toBeNull();
	});

	it("ignores a truncated message rather than reading undefined bytes", () => {
		expect(parseMidiMessage(Uint8Array.from([MIDI_NOTE_ON]), 0)).toBeNull();
		expect(parseMidiMessage(Uint8Array.from([MIDI_NOTE_ON, 60]), 0)).toBeNull();
		expect(parseMidiMessage(Uint8Array.from([]), 0)).toBeNull();
	});

	it("ignores a note number outside the MIDI range", () => {
		expect(parseMidiMessage(Uint8Array.from([MIDI_NOTE_ON, 200, 90]), 0))
			.toBeNull();
	});
});

describe("reduceMidiToPhrase", () => {
	it("returns nothing for no events", () => {
		expect(reduceMidiToPhrase([])).toEqual([]);
	});

	it("pairs one note-on with its note-off", () => {
		const phrase = reduceMidiToPhrase([on(MIDDLE_C, 1000), off(MIDDLE_C, 1500)]);
		expect(phrase).toEqual([
			{ frequency: midiNoteToFrequency(MIDDLE_C), onsetMs: 1000, durationMs: 500 },
		]);
	});

	it("produces the same RawPhrase shape the microphone path emits", () => {
		const phrase = reduceMidiToPhrase([
			on(MIDDLE_C, 0),
			off(MIDDLE_C, 500),
			on(D4, 500),
			off(D4, 1000),
		]);
		for (const note of phrase) {
			expect(Object.keys(note).sort()).toEqual([
				"durationMs",
				"frequency",
				"onsetMs",
			]);
		}
	});

	it("keeps notes in onset order even when events arrive interleaved", () => {
		const phrase = reduceMidiToPhrase([
			on(MIDDLE_C, 0),
			on(E4, 100),
			off(MIDDLE_C, 400),
			on(G4, 500),
			off(E4, 600),
			off(G4, 900),
		]);
		expect(phrase.map((n) => n.onsetMs)).toEqual([0, 100, 500]);
	});

	it("ignores a note-off with no matching note-on", () => {
		expect(reduceMidiToPhrase([off(MIDDLE_C, 500)])).toEqual([]);
	});

	it("closes a note still held when the phrase ends", () => {
		// Lifting your hands after stopping should not lose the last note.
		const phrase = reduceMidiToPhrase([on(MIDDLE_C, 1000), on(D4, 1200)], 1800);
		expect(phrase).toHaveLength(2);
		expect(phrase[0].durationMs).toBe(800);
		expect(phrase[1].durationMs).toBe(600);
	});

	it("drops a held note when there is no end time to close it against", () => {
		expect(reduceMidiToPhrase([on(MIDDLE_C, 1000)])).toEqual([]);
	});

	it("retriggers a repeated note-on as two separate notes", () => {
		const phrase = reduceMidiToPhrase([
			on(MIDDLE_C, 0),
			on(MIDDLE_C, 300),
			off(MIDDLE_C, 600),
		]);
		expect(phrase).toHaveLength(2);
		expect(phrase[0]).toMatchObject({ onsetMs: 0, durationMs: 300 });
		expect(phrase[1]).toMatchObject({ onsetMs: 300, durationMs: 300 });
	});

	it("never emits a negative duration from out-of-order timestamps", () => {
		const phrase = reduceMidiToPhrase([on(MIDDLE_C, 1000), off(MIDDLE_C, 400)]);
		expect(phrase[0].durationMs).toBe(0);
	});

	it("converts note numbers to equal-tempered frequencies", () => {
		const phrase = reduceMidiToPhrase([on(69, 0), off(69, 100)]);
		expect(phrase[0].frequency).toBeCloseTo(440, 6);
	});
});

describe("MIDI feeds the existing pipeline unchanged", () => {
	it("quantizes to the same Phrase a microphone capture of the same notes would", () => {
		const events: MidiNoteMessage[] = [
			on(MIDDLE_C, 1000),
			off(MIDDLE_C, 1660),
			on(D4, 1660),
			off(D4, 2000),
			on(E4, 2000),
			off(E4, 3330),
			on(G4, 3330),
			off(G4, 4000),
		];

		// The equivalent microphone-path RawPhrase for the same performance.
		const micRaw = [
			{ frequency: midiNoteToFrequency(MIDDLE_C), onsetMs: 1000, durationMs: 660 },
			{ frequency: midiNoteToFrequency(D4), onsetMs: 1660, durationMs: 340 },
			{ frequency: midiNoteToFrequency(E4), onsetMs: 2000, durationMs: 1330 },
			{ frequency: midiNoteToFrequency(G4), onsetMs: 3330, durationMs: 670 },
		];

		expect(quantizePhrase(reduceMidiToPhrase(events))).toEqual(
			quantizePhrase(micRaw),
		);
	});

	it("quantizes MIDI input into recognisable pitches", () => {
		const phrase = quantizePhrase(
			reduceMidiToPhrase([
				on(MIDDLE_C, 0),
				off(MIDDLE_C, 500),
				on(E4, 500),
				off(E4, 1000),
				on(G4, 1000),
				off(G4, 1500),
			]),
		);
		expect(phrase.notes.map((n) => n.pitch)).toEqual(["C", "E", "G"]);
		expect(phrase.notes.every((n) => n.octave === 4)).toBe(true);
	});
});

describe("MidiSession", () => {
	it("collects messages and folds them into a phrase on finish", () => {
		const session = new MidiSession();
		session.push(on(MIDDLE_C, 0));
		session.push(off(MIDDLE_C, 500));
		expect(session.finish(500)).toHaveLength(1);
	});

	it("reports capturing until it is finished", () => {
		const session = new MidiSession();
		expect(session.isCapturing).toBe(true);
		session.finish(0);
		expect(session.isCapturing).toBe(false);
	});

	it("ignores messages after finish", () => {
		const session = new MidiSession();
		session.push(on(MIDDLE_C, 0));
		session.push(off(MIDDLE_C, 100));
		session.finish(100);
		session.push(on(D4, 200));
		expect(session.finish(300)).toHaveLength(1);
	});

	it("stops collecting past the shared session timeout", () => {
		// Uses the same cap as the microphone path so both modalities behave alike.
		const session = new MidiSession();
		session.push(on(MIDDLE_C, 0));
		session.push(off(MIDDLE_C, 100));
		session.push(on(D4, SESSION_TIMEOUT_MS + 1000));
		session.push(off(D4, SESSION_TIMEOUT_MS + 1500));
		expect(session.finish(SESSION_TIMEOUT_MS + 1500)).toHaveLength(1);
	});
});

describe("isWebMidiAvailable", () => {
	it("reports false in an environment without Web MIDI", () => {
		// jsdom ships no requestMIDIAccess, which is the same shape as Safari.
		expect(isWebMidiAvailable()).toBe(false);
	});

	it("reports true when the browser exposes requestMIDIAccess", () => {
		// Narrow the global to a plain record so the stub does not have to satisfy
		// the full MIDIAccess surface just to prove feature detection works.
		const nav = navigator as unknown as Record<string, unknown>;
		nav.requestMIDIAccess = () => Promise.resolve({});
		try {
			expect(isWebMidiAvailable()).toBe(true);
		} finally {
			delete nav.requestMIDIAccess;
		}
	});
});

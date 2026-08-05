import { SESSION_TIMEOUT_MS } from "./capture";
import type { RawNote, RawPhrase } from "./capture";
import { midiNoteToFrequency } from "./quantize";

/**
 * Web MIDI input.
 *
 * MIDI replaces only the front of the pipeline. A performance is folded into
 * the exact {@link RawPhrase} the microphone path produces, so `quantizePhrase`,
 * `detectKey`, `harmonize`, and the renderer are reused untouched.
 *
 * MIDI gives exact onsets, so the quantizer has a cleaner signal here than it
 * does from pitch detection. That is a better input to the same code, not a
 * reason for different code.
 */

/** Status nibbles. The low nibble of a status byte carries the channel. */
export const MIDI_NOTE_OFF = 0x80;
export const MIDI_NOTE_ON = 0x90;
const STATUS_MASK = 0xf0;

/** Highest valid MIDI note number. */
const MAX_MIDI_NOTE = 127;

/** A parsed note-on or note-off, with the time it arrived. */
export interface MidiNoteMessage {
	kind: "on" | "off";
	/** MIDI note number, 0-127. */
	note: number;
	/** 0-127; zero on a note-on means note-off by convention. */
	velocity: number;
	/** Milliseconds on the same clock the microphone path uses. */
	timeMs: number;
}

/**
 * Parse one raw MIDI message into a note event.
 *
 * Returns null for anything that is not a note — control change, pitch bend,
 * clock, or a truncated message. Those are normal traffic on a MIDI cable, so
 * ignoring them is correct behaviour rather than a swallowed error.
 */
export function parseMidiMessage(
	data: Uint8Array,
	timeMs: number,
): MidiNoteMessage | null {
	if (data.length < 3) return null;

	const status = data[0] & STATUS_MASK;
	if (status !== MIDI_NOTE_ON && status !== MIDI_NOTE_OFF) return null;

	const note = data[1];
	const velocity = data[2];
	if (note > MAX_MIDI_NOTE) return null;

	// A note-on with zero velocity is a note-off. Keyboards using running status
	// send it this way, and treating it as an onset would hang the note forever.
	const kind: MidiNoteMessage["kind"] =
		status === MIDI_NOTE_ON && velocity > 0 ? "on" : "off";

	return { kind, note, velocity, timeMs };
}

/**
 * Fold a stream of note messages into a {@link RawPhrase}.
 *
 * Pure and order-preserving: notes come out sorted by onset, which is the
 * order the quantizer expects. Notes are paired by note number, so overlapping
 * notes each become their own entry rather than being merged — the melody is
 * taken as played.
 *
 * @param endMs Time to close notes still held when the performance stopped.
 *   Without it, a note whose key was never released is dropped, because there
 *   is no honest duration to give it.
 */
export function reduceMidiToPhrase(
	messages: readonly MidiNoteMessage[],
	endMs?: number,
): RawPhrase {
	const notes: RawNote[] = [];
	/** Note number -> the onset time of the currently sounding instance. */
	const sounding = new Map<number, number>();

	const closeNote = (note: number, onsetMs: number, offMs: number): void => {
		notes.push({
			frequency: midiNoteToFrequency(note),
			onsetMs,
			// Clamp: a device with a jittery clock must not produce a negative span.
			durationMs: Math.max(0, offMs - onsetMs),
		});
	};

	for (const message of messages) {
		const openedAt = sounding.get(message.note);

		if (message.kind === "on") {
			// A second note-on without an intervening note-off is a retrigger:
			// close the sounding instance and start a new one.
			if (openedAt !== undefined) closeNote(message.note, openedAt, message.timeMs);
			sounding.set(message.note, message.timeMs);
			continue;
		}

		// A note-off with nothing sounding is stray traffic, not an error.
		if (openedAt === undefined) continue;
		closeNote(message.note, openedAt, message.timeMs);
		sounding.delete(message.note);
	}

	if (endMs !== undefined)
		for (const [note, onsetMs] of sounding) closeNote(note, onsetMs, endMs);

	return notes.sort((a, b) => a.onsetMs - b.onsetMs);
}

/**
 * Stateful wrapper mirroring `CaptureSession`: buffer messages as they arrive,
 * enforce the same session cap, and fold to a phrase on stop. Both modalities
 * share the timeout so a MIDI take and a hummed take behave alike.
 */
export class MidiSession {
	private messages: MidiNoteMessage[] = [];
	private startMs: number | null = null;
	private ended = false;

	push(message: MidiNoteMessage): void {
		if (this.ended) return;
		if (this.startMs === null) this.startMs = message.timeMs;
		if (message.timeMs - this.startMs > SESSION_TIMEOUT_MS) {
			this.ended = true;
			return;
		}
		this.messages.push(message);
	}

	finish(endMs: number): RawPhrase {
		this.ended = true;
		return reduceMidiToPhrase(this.messages, endMs);
	}

	get isCapturing(): boolean {
		return !this.ended;
	}
}

/**
 * True when this browser exposes the Web MIDI API.
 *
 * Safari does not ship it, so the UI feature-detects and hides the MIDI toggle
 * rather than offering an input that can never connect.
 */
export function isWebMidiAvailable(): boolean {
	try {
		return (
			typeof navigator !== "undefined" &&
			typeof navigator.requestMIDIAccess === "function"
		);
	} catch {
		// Some engines throw on the property access itself in restricted contexts.
		return false;
	}
}

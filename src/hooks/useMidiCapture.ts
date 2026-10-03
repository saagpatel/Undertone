import { useCallback, useEffect, useRef, useState } from "react";
import {
	MidiSession,
	isWebMidiAvailable,
	parseMidiMessage,
} from "../dsp/midi";
import type { MidiNoteMessage } from "../dsp/midi";
import type { PitchResult } from "../dsp/pitch";
import { midiNoteToFrequency, quantizePhrase } from "../dsp/quantize";
import type { Phrase } from "../dsp/quantize";

/** A connected MIDI input, as offered in the device picker. */
export interface MidiDevice {
	id: string;
	name: string;
}

export interface MidiCapture {
	/** False when the browser has no Web MIDI API at all (Safari). */
	isSupported: boolean;
	devices: MidiDevice[];
	selectedDeviceId: string | null;
	selectDevice: (id: string) => void;
	/** Synthetic reading of the note currently held, for the live meter. */
	pitch: PitchResult | null;
	phrase: Phrase | null;
	/** Increments once per completed take, mirroring `useCapture`. */
	captureId: number;
	isCapturing: boolean;
	error: string | null;
	/** Request access and enumerate inputs. Safe to call more than once. */
	connect: () => Promise<void>;
	start: () => void;
	stop: () => void;
}

/** The clock both input modalities share, so takes are directly comparable. */
function now(): number {
	return performance.now();
}

function describe(error: unknown): string {
	if (error instanceof Error) return error.message;
	return "The MIDI device could not be reached.";
}

/**
 * Web MIDI as a second input modality.
 *
 * This hook owns only the front of the pipeline: it turns raw MIDI traffic
 * into the same {@link Phrase} the microphone path produces. Everything
 * downstream — key detection, harmonization, engraving, playback, saving,
 * sharing — is reused with no knowledge that MIDI exists.
 *
 * Nothing here touches the microphone, so the mic path is unaffected whether
 * or not a keyboard is plugged in.
 */
export function useMidiCapture(): MidiCapture {
	const [isSupported] = useState(isWebMidiAvailable);
	const [devices, setDevices] = useState<MidiDevice[]>([]);
	const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);
	const [pitch, setPitch] = useState<PitchResult | null>(null);
	const [phrase, setPhrase] = useState<Phrase | null>(null);
	const [captureId, setCaptureId] = useState(0);
	const [isCapturing, setIsCapturing] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const accessRef = useRef<MIDIAccess | null>(null);
	const sessionRef = useRef<MidiSession | null>(null);
	/** Note numbers currently held, so the meter can clear on release. */
	const heldRef = useRef<Set<number>>(new Set());

	const readInputs = useCallback((access: MIDIAccess): MidiDevice[] => {
		const found: MidiDevice[] = [];
		access.inputs.forEach((input) => {
			found.push({
				id: input.id,
				name: input.name ?? input.manufacturer ?? "MIDI device",
			});
		});
		return found;
	}, []);

	const connect = useCallback(async () => {
		if (!isSupported) {
			setError("This browser does not support Web MIDI.");
			return;
		}
		try {
			const access = accessRef.current ?? (await navigator.requestMIDIAccess());
			accessRef.current = access;

			const found = readInputs(access);
			setDevices(found);
			setSelectedDeviceId((current) =>
				current && found.some((d) => d.id === current)
					? current
					: (found[0]?.id ?? null),
			);
			setError(
				found.length === 0
					? "No MIDI device found. Connect a keyboard and try again."
					: null,
			);

			// Keep the picker honest as devices come and go mid-session.
			access.onstatechange = () => {
				const refreshed = readInputs(access);
				setDevices(refreshed);
				setSelectedDeviceId((current) =>
					current && refreshed.some((d) => d.id === current)
						? current
						: (refreshed[0]?.id ?? null),
				);
			};
		} catch (problem) {
			console.error("Undertone: could not reach the MIDI system.", problem);
			setError(describe(problem));
		}
	}, [isSupported, readInputs]);

	// Route messages from the selected input into the active session.
	useEffect(() => {
		const access = accessRef.current;
		if (!access || !selectedDeviceId) return;

		const input = access.inputs.get(selectedDeviceId);
		if (!input) return;

		const applyToMeter = (message: MidiNoteMessage) => {
			const held = heldRef.current;
			if (message.kind === "on") {
				held.add(message.note);
				setPitch({
					frequency: midiNoteToFrequency(message.note),
					// MIDI reports exactly what was played; there is nothing to doubt.
					confidence: 1,
					rms: message.velocity / 127,
					peak: message.velocity / 127,
					timestamp: message.timeMs,
				});
				return;
			}
			held.delete(message.note);
			if (held.size === 0) setPitch(null);
		};

		const handle = (event: MIDIMessageEvent) => {
			if (!event.data) return;
			const message = parseMidiMessage(event.data, now());
			if (!message) return;

			applyToMeter(message);
			sessionRef.current?.push(message);
		};

		input.addEventListener("midimessage", handle);

		// Open the port explicitly. A MIDIInput only delivers messages once it is
		// open, and implementations differ on whether addEventListener opens it
		// implicitly the way assigning onmidimessage does. Being explicit removes
		// a whole class of "the keyboard is connected but no notes arrive".
		let cancelled = false;
		void input
			.open()
			.then(() => {
				if (!cancelled) setError(null);
			})
			.catch((problem: unknown) => {
				if (cancelled) return;
				console.error("Undertone: could not open the MIDI input.", problem);
				setError(describe(problem));
			});

		return () => {
			cancelled = true;
			input.removeEventListener("midimessage", handle);
		};
	}, [selectedDeviceId, devices]);

	const start = useCallback(() => {
		setPhrase(null);
		setPitch(null);
		heldRef.current.clear();
		sessionRef.current = new MidiSession();
		setIsCapturing(true);
	}, []);

	const stop = useCallback(() => {
		const session = sessionRef.current;
		sessionRef.current = null;
		setIsCapturing(false);
		setPitch(null);
		heldRef.current.clear();
		if (!session) return;
		setPhrase(quantizePhrase(session.finish(now())));
		setCaptureId((previous) => previous + 1);
	}, []);

	useEffect(() => {
		return () => {
			const access = accessRef.current;
			if (access) access.onstatechange = null;
		};
	}, []);

	return {
		isSupported,
		devices,
		selectedDeviceId,
		selectDevice: setSelectedDeviceId,
		pitch,
		phrase,
		captureId,
		isCapturing,
		error,
		connect,
		start,
		stop,
	};
}

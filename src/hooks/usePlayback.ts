import { useCallback, useEffect, useRef, useState } from "react";
import type { Chord } from "../dsp/harmony";
import {
	buildAccompanimentSchedule,
	buildSchedule,
	type ScheduledNote,
	scheduleDuration,
} from "../dsp/playback";
import type { Phrase } from "../dsp/quantize";

export interface Playback {
	/** True from the first scheduled note until the last one finishes (or stop). */
	isPlaying: boolean;
	/** Play the phrase. MUST be called from a user gesture (AudioContext policy). */
	play: () => void;
	/** Stop immediately with a short fade — no click, no lingering sound. */
	stop: () => void;
}

const LEAD_TIME = 0.05; // s of headroom before the first note starts
const DETUNE_CENTS = 6; // two slightly-detuned sines per note → warmth
const ATTACK = 0.012; // s gain ramp in (de-click)
const RELEASE = 0.08; // s gain ramp out (de-click)
const PEAK = 0.18; // per-note gain for melody; two oscillators sum beneath it
const ACCOMPANIMENT_PEAK = 0.05; // much lower — sits under the melody
const STOP_FADE = 0.03; // s fade applied by stop()

interface Voice {
	osc: OscillatorNode;
	gain: GainNode;
}

/**
 * Schedule a set of {@link ScheduledNote}s as oscillators against `base`
 * (absolute AudioContext time). Returns the created {@link Voice} objects so
 * the caller can collect them for cleanup.
 *
 * Each note gets a single oscillator through a dedicated GainNode with a
 * short attack/release envelope to prevent clicks.  The `detune` array lets
 * the caller pass multiple cent offsets; one oscillator is created per offset
 * (melody uses [-6, +6] for warmth; accompaniment uses [0] for a clean tone).
 */
function scheduleVoice(
	ctx: AudioContext,
	schedule: ScheduledNote[],
	base: number,
	opts: {
		peak: number;
		type: OscillatorType;
		detune?: number[];
	},
): Voice[] {
	const detuneValues = opts.detune ?? [0];
	const voices: Voice[] = [];

	for (const note of schedule) {
		const start = base + note.startSec;
		const end = start + note.durationSec;

		const gain = ctx.createGain();
		gain.connect(ctx.destination);
		gain.gain.setValueAtTime(0, start);
		gain.gain.linearRampToValueAtTime(opts.peak, start + ATTACK);
		gain.gain.setValueAtTime(
			opts.peak,
			Math.max(start + ATTACK, end - RELEASE),
		);
		gain.gain.linearRampToValueAtTime(0, end);

		for (const cents of detuneValues) {
			const osc = ctx.createOscillator();
			osc.type = opts.type;
			osc.frequency.setValueAtTime(note.frequency, start);
			osc.detune.setValueAtTime(cents, start);
			osc.connect(gain);
			osc.start(start);
			osc.stop(end + 0.02);
			voices.push({ osc, gain });
		}
	}

	return voices;
}

/**
 * Web Audio playback of a captured {@link Phrase} with optional chord
 * accompaniment. Every note's start time is derived from a single
 * `AudioContext.currentTime` base, so melody and accompaniment never
 * accumulate scheduling drift. The AudioContext is created lazily on the
 * first play (a user gesture) and reused for the component's lifetime.
 *
 * When `chords` are provided, {@link buildAccompanimentSchedule} voices them
 * as triangle-wave tones at a much lower gain (~0.05) so they sit underneath
 * the melody without competing with it.
 */
export function usePlayback(phrase: Phrase | null, chords?: Chord[]): Playback {
	const contextRef = useRef<AudioContext | null>(null);
	const voicesRef = useRef<Voice[]>([]);
	const endTimerRef = useRef<number | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);

	const stop = useCallback(() => {
		const ctx = contextRef.current;
		if (ctx) {
			const now = ctx.currentTime;
			for (const { osc, gain } of voicesRef.current) {
				try {
					gain.gain.cancelScheduledValues(now);
					gain.gain.setValueAtTime(gain.gain.value, now);
					gain.gain.linearRampToValueAtTime(0, now + STOP_FADE);
					osc.stop(now + STOP_FADE + 0.01);
				} catch {
					// Oscillator may have already stopped; nothing to clean up.
				}
			}
		}
		voicesRef.current = [];
		if (endTimerRef.current !== null) {
			clearTimeout(endTimerRef.current);
			endTimerRef.current = null;
		}
		setIsPlaying(false);
	}, []);

	const play = useCallback(() => {
		if (!phrase || phrase.notes.length === 0) return;
		stop(); // never overlap a previous run

		const ctx = contextRef.current ?? (contextRef.current = new AudioContext());
		void ctx.resume();

		// Single base for both melody and accompaniment — zero drift.
		const base = ctx.currentTime + LEAD_TIME;

		// ── Melody ──────────────────────────────────────────────────────────────
		const melodySchedule = buildSchedule(phrase);
		const melodyVoices = scheduleVoice(ctx, melodySchedule, base, {
			peak: PEAK,
			type: "sine",
			detune: [-DETUNE_CENTS, DETUNE_CENTS],
		});

		// ── Accompaniment (built once; reused for scheduling + duration) ──────────
		const accompSchedule =
			chords && chords.length > 0
				? buildAccompanimentSchedule(chords, phrase.bpm)
				: [];
		const accompVoices = scheduleVoice(ctx, accompSchedule, base, {
			peak: ACCOMPANIMENT_PEAK,
			type: "triangle",
			// No detune — clean sustained tones under the melody.
		});

		voicesRef.current = [...melodyVoices, ...accompVoices];
		setIsPlaying(true);

		// End timer: use the MAX of melody and accompaniment durations.
		const totalMs =
			(LEAD_TIME +
				Math.max(
					scheduleDuration(melodySchedule),
					scheduleDuration(accompSchedule),
				)) *
				1000 +
			60;

		endTimerRef.current = window.setTimeout(() => {
			voicesRef.current = [];
			endTimerRef.current = null;
			setIsPlaying(false);
		}, totalMs);
	}, [phrase, chords, stop]);

	// Stop any in-flight playback when the phrase changes (a new capture).
	useEffect(() => stop, [phrase, stop]);

	// Release the AudioContext when the host unmounts.
	useEffect(() => {
		return () => {
			stop();
			void contextRef.current?.close();
			contextRef.current = null;
		};
	}, [stop]);

	return { isPlaying, play, stop };
}

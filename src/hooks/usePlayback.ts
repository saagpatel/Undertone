import { useCallback, useEffect, useRef, useState } from "react";
import { buildSchedule, scheduleDuration } from "../dsp/playback";
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
const PEAK = 0.18; // per-note gain; two oscillators sum beneath it
const STOP_FADE = 0.03; // s fade applied by stop()

interface Voice {
	osc: OscillatorNode;
	gain: GainNode;
}

/**
 * Web Audio playback of a captured {@link Phrase}. Every note's start time is
 * derived from a single `AudioContext.currentTime` base, so the sequence never
 * accumulates scheduling drift. Each note is two detuned sine oscillators
 * through a short attack/release envelope, which keeps the tone warm and the
 * starts/stops free of clicks. The AudioContext is created lazily on the first
 * play (a user gesture) and reused for the component's lifetime.
 */
export function usePlayback(phrase: Phrase | null): Playback {
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

		const schedule = buildSchedule(phrase);
		const base = ctx.currentTime + LEAD_TIME; // single base → zero drift
		const voices: Voice[] = [];

		for (const note of schedule) {
			const start = base + note.startSec;
			const end = start + note.durationSec;

			const gain = ctx.createGain();
			gain.connect(ctx.destination);
			gain.gain.setValueAtTime(0, start);
			gain.gain.linearRampToValueAtTime(PEAK, start + ATTACK);
			gain.gain.setValueAtTime(PEAK, Math.max(start + ATTACK, end - RELEASE));
			gain.gain.linearRampToValueAtTime(0, end);

			for (const detune of [-DETUNE_CENTS, DETUNE_CENTS]) {
				const osc = ctx.createOscillator();
				osc.type = "sine";
				osc.frequency.setValueAtTime(note.frequency, start);
				osc.detune.setValueAtTime(detune, start);
				osc.connect(gain);
				osc.start(start);
				osc.stop(end + 0.02);
				voices.push({ osc, gain });
			}
		}

		voicesRef.current = voices;
		setIsPlaying(true);

		const totalMs = (LEAD_TIME + scheduleDuration(schedule)) * 1000 + 60;
		endTimerRef.current = window.setTimeout(() => {
			voicesRef.current = [];
			endTimerRef.current = null;
			setIsPlaying(false);
		}, totalMs);
	}, [phrase, stop]);

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

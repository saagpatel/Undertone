import type { Chord } from "./harmony";
import type { Accidental, NoteName } from "./quantize";

/**
 * A {@link ChordTone} with an assigned octave — ready to feed into
 * {@link noteFrequency}.
 */
export interface VoicedTone {
	pitch: NoteName;
	accidental: Accidental;
	octave: number;
}

/**
 * A chord voiced into concrete pitches: a single bass note one octave below
 * the triad root, plus three triad tones ascending from the root position.
 */
export interface VoicedChord {
	bass: VoicedTone;
	triad: VoicedTone[];
}

/** Semitone offset above C for each natural pitch class (mirrors quantize.ts). */
const NATURAL_SEMITONES: Record<NoteName, number> = {
	C: 0,
	D: 2,
	E: 4,
	F: 5,
	G: 7,
	A: 9,
	B: 11,
};

/** Absolute semitone count for a pitch class + accidental within one octave. */
function pitchClassSemitone(pitch: NoteName, accidental: Accidental): number {
	const offset = accidental === "sharp" ? 1 : accidental === "flat" ? -1 : 0;
	return (NATURAL_SEMITONES[pitch] + offset + 12) % 12;
}

/**
 * Place {@link Chord} tones into concrete octaves, producing a
 * {@link VoicedChord} suitable for oscillator scheduling.
 *
 * Algorithm:
 *  - Root (tones[0]) sits at `triadOctave` (default 3).
 *  - Each subsequent tone uses the LOWEST octave that keeps it STRICTLY higher
 *    in pitch than the previous tone. When a pitch class's semitone value is
 *    ≤ the previous tone's semitone value (within the same octave), bump up by 1.
 *  - Bass = chord.root at `bassOctave` (default 2).
 *
 * Pure and deterministic — never mutates the input chord.
 */
export function voiceChord(
	chord: Chord,
	opts?: { bassOctave?: number; triadOctave?: number },
): VoicedChord {
	const triadOctave = opts?.triadOctave ?? 3;
	const bassOctave = opts?.bassOctave ?? 2;

	const triad: VoicedTone[] = [];
	let prevSemitone = -1; // sentinel — first tone always placed at triadOctave
	let currentOctave = triadOctave;

	for (let i = 0; i < chord.tones.length; i++) {
		const tone = chord.tones[i];
		const pc = pitchClassSemitone(tone.pitch, tone.accidental);

		if (i === 0) {
			// Root is always placed exactly at triadOctave.
			triad.push({
				pitch: tone.pitch,
				accidental: tone.accidental,
				octave: triadOctave,
			});
			prevSemitone = pc;
			currentOctave = triadOctave;
		} else {
			// Find the lowest octave where this tone sits strictly above the
			// previous tone in absolute pitch. Most of the time it's the same
			// octave; when the pitch class wraps below the previous one, bump.
			let octave = currentOctave;
			// Absolute semitone of this tone at the candidate octave vs previous
			// tone's absolute semitone (prevSemitone already captures just the
			// pitch-class part; "absolute" comparison uses octave offset).
			//
			// We compare pitch-class values directly within the candidate octave:
			// if pc <= prevSemitone it means the new note would be at or below the
			// previous tone within the same octave, so increment.
			if (pc <= prevSemitone) {
				octave = currentOctave + 1;
			}
			triad.push({ pitch: tone.pitch, accidental: tone.accidental, octave });
			prevSemitone = pc;
			currentOctave = octave;
		}
	}

	const bass: VoicedTone = {
		pitch: chord.root.pitch,
		accidental: chord.root.accidental,
		octave: bassOctave,
	};

	return { bass, triad };
}

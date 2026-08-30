import type { RawPhrase } from "../../src/dsp/capture";
import type { PitchResult } from "../../src/dsp/pitch";

const transpose = (frequency: number, cents: number) =>
	frequency * 2 ** (cents / 1200);

export const cleanBaseline: RawPhrase = [
	{ frequency: 440, onsetMs: 0, durationMs: 380 },
	{ frequency: 493.88, onsetMs: 500, durationMs: 380 },
	{ frequency: 523.25, onsetMs: 1000, durationMs: 380 },
	{ frequency: 587.33, onsetMs: 1500, durationMs: 520 },
];

export const transposedUpTwo: RawPhrase = cleanBaseline.map((note) => ({
	...note,
	frequency: transpose(note.frequency, 200),
}));

export const transposedWithLocalDrift: RawPhrase = cleanBaseline.map(
	(note, index) => ({
		...note,
		frequency: transpose(note.frequency, 200 + [20, -25, 40, -10][index]),
	}),
);

export const fasterSameContour: RawPhrase = cleanBaseline.map((note) => ({
	...note,
	onsetMs: note.onsetMs * 0.8,
	durationMs: note.durationMs * 0.8,
}));

export const timingDrift: RawPhrase = cleanBaseline.map((note, index) => ({
	...note,
	onsetMs: [0, 535, 970, 1570][index],
}));

export const oneOctaveError: RawPhrase = cleanBaseline.map((note, index) => ({
	...note,
	frequency: index === 2 ? note.frequency * 2 : note.frequency,
}));

export const octaveShift: RawPhrase = cleanBaseline.map((note) => ({
	...note,
	frequency: note.frequency * 2,
}));

export const fewerNotes: RawPhrase = cleanBaseline.slice(0, 2);

export const extraPassingNote: RawPhrase = [
	cleanBaseline[0],
	cleanBaseline[1],
	{ frequency: 508, onsetMs: 760, durationMs: 150 },
	cleanBaseline[2],
	cleanBaseline[3],
];

export function fixtureFrame(
	overrides: Partial<PitchResult> = {},
): PitchResult {
	return {
		frequency: 440,
		confidence: 0.98,
		rms: 0.12,
		peak: 0.25,
		timestamp: 0,
		...overrides,
	};
}

export const adverseFrames = {
	silence: fixtureFrame({ frequency: 0, confidence: 0, rms: 0, peak: 0 }),
	backgroundNoise: fixtureFrame({
		frequency: 0,
		confidence: 0.1,
		rms: 0.18,
		peak: 0.42,
	}),
	lowConfidence: fixtureFrame({ confidence: 0.55 }),
	clipped: fixtureFrame({ peak: 1 }),
	outOfRange: fixtureFrame({ frequency: 1200 }),
} as const;

import type { Phrase } from "../../src/dsp/quantize";

/** Reference phrase used by the notation tests: C4 quarter, E4 quarter, G4 half. */
export const fixturePhrase: Phrase = {
	notes: [
		{
			pitch: "C",
			accidental: null,
			octave: 4,
			noteValue: "quarter",
			beatPosition: 0,
		},
		{
			pitch: "E",
			accidental: null,
			octave: 4,
			noteValue: "quarter",
			beatPosition: 1,
		},
		{
			pitch: "G",
			accidental: null,
			octave: 4,
			noteValue: "half",
			beatPosition: 2,
		},
	],
	timeSignatureNumerator: 4,
	timeSignatureDenominator: 4,
	bpm: 90,
};

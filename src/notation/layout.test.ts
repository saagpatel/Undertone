import { describe, expect, it } from "vitest";
import type { NoteEvent, NoteName, NoteValue, Phrase } from "../dsp/quantize";
import {
	bassStaffGeometry,
	beamGroups,
	beatToX,
	CLEF_GAP_FACTOR,
	diatonicValue,
	measureBoundaries,
	notationHeight,
	notePosition,
	notePositionBass,
	PIXELS_PER_BEAT_FACTOR,
	phraseEndBeat,
	staffGeometry,
	TIME_SIG_GAP,
} from "./layout";

const geom = staffGeometry({ x: 0, y: 0, width: 100, lineSpacing: 10 });
const at = (pitch: NoteName, octave: number): number =>
	notePosition({ pitch, octave }, geom);

describe("notePosition (treble clef, top line y=0, lineSpacing 10)", () => {
	it("places the five staff lines F5 / D5 / B4 / G4 / E4", () => {
		expect(at("F", 5)).toBe(0); // top line
		expect(at("D", 5)).toBe(10);
		expect(at("B", 4)).toBe(20); // middle line
		expect(at("G", 4)).toBe(30);
		expect(at("E", 4)).toBe(40); // bottom line
	});

	it("places the staff spaces between the lines", () => {
		expect(at("E", 5)).toBe(5); // top space
		expect(at("C", 5)).toBe(15);
		expect(at("A", 4)).toBe(25);
		expect(at("F", 4)).toBe(35);
	});

	it("puts middle C (C4) one ledger line below the bottom line", () => {
		const bottomLineY = geom.y + (geom.numLines - 1) * geom.lineSpacing; // 40
		expect(at("C", 4)).toBe(bottomLineY + geom.lineSpacing); // 50
	});

	it("puts A5 on the first ledger line above the top line", () => {
		const topLineY = geom.y; // 0
		expect(at("G", 5)).toBe(-5); // space just above the top line
		expect(at("A", 5)).toBe(topLineY - geom.lineSpacing); // -10, first ledger above
	});

	it("is monotonic across octaves 3-6 (higher pitch → smaller y)", () => {
		expect(at("C", 3)).toBeGreaterThan(at("C", 4));
		expect(at("C", 4)).toBeGreaterThan(at("C", 5));
		expect(at("C", 5)).toBeGreaterThan(at("C", 6));
	});
});

describe("bassStaffGeometry + notePositionBass (bass clef, lineSpacing 10)", () => {
	const treble = staffGeometry({ x: 0, y: 0, width: 100, lineSpacing: 10 });
	const bass = bassStaffGeometry(treble);
	const atBass = (pitch: NoteName, octave: number): number =>
		notePositionBass({ pitch, octave }, bass);

	it("sits 8 line-spaces below the treble (6 diatonic + 2 gap)", () => {
		// F5 → A3 is 12 diatonic steps = 6 spaces, plus a 2-space inter-staff gap.
		expect(bass.y).toBe(treble.y + 8 * treble.lineSpacing); // 80
		expect(bass.lineSpacing).toBe(treble.lineSpacing);
		expect(bass.x).toBe(treble.x);
		expect(bass.width).toBe(treble.width);
	});

	it("places the five bass staff lines G2 / B2 / D3 / F3 / A3", () => {
		expect(atBass("A", 3)).toBe(bass.y); // top line
		expect(atBass("F", 3)).toBe(bass.y + 10); // 4th line up — the clef line
		expect(atBass("D", 3)).toBe(bass.y + 20); // middle line
		expect(atBass("B", 2)).toBe(bass.y + 30);
		expect(atBass("G", 2)).toBe(bass.y + 40); // bottom line
	});

	it("puts middle C (C4) one ledger line above the bass staff", () => {
		expect(atBass("C", 4)).toBe(bass.y - 10);
	});

	it("keeps the bass clear of the treble: high chord tones sit below it", () => {
		// The inter-staff gap drops the bass so octave-4 chord tones (vii°'s F4,
		// the highest reachable) land below the treble bottom line (E4), not in it.
		const trebleBottomLine = notePosition({ pitch: "E", octave: 4 }, treble);
		expect(atBass("F", 4)).toBeGreaterThan(trebleBottomLine);
		expect(atBass("E", 4)).toBeGreaterThan(trebleBottomLine);
	});

	it("is monotonic (higher pitch → smaller y)", () => {
		expect(atBass("C", 2)).toBeGreaterThan(atBass("C", 3));
		expect(atBass("C", 3)).toBeGreaterThan(atBass("C", 4));
	});
});

describe("notationHeight", () => {
	const treble = staffGeometry({ x: 0, y: 20, width: 100, lineSpacing: 10 });

	it("single staff (v1): top line to bottom line plus a symmetric margin", () => {
		// treble.y*2 + (numLines-1)*lineSpacing — matches the pre-grand-staff VIEW_H.
		expect(notationHeight(treble, false)).toBe(20 * 2 + 4 * 10); // 80
	});

	it("grand staff: extends to the bass bottom line plus margin and bass cushion", () => {
		const bass = bassStaffGeometry(treble);
		const bassBottom = bass.y + (treble.numLines - 1) * treble.lineSpacing;
		// Symmetric margin (treble.y) + one line-space cushion for the bass voice.
		expect(notationHeight(treble, true)).toBe(
			bassBottom + treble.y + treble.lineSpacing,
		);
		expect(notationHeight(treble, true)).toBeGreaterThan(
			notationHeight(treble, false),
		);
	});
});

describe("diatonicValue", () => {
	it("orders pitches by absolute diatonic step", () => {
		expect(diatonicValue("C", 4)).toBe(28);
		expect(diatonicValue("B", 4)).toBe(34);
		expect(diatonicValue("F", 5)).toBe(38);
	});
});

describe("beamGroups", () => {
	const note = (noteValue: NoteValue, beatPosition: number): NoteEvent => ({
		pitch: "C",
		accidental: null,
		octave: 4,
		noteValue,
		beatPosition,
	});

	it("groups consecutive eighth/sixteenth runs and isolates other values", () => {
		const groups = beamGroups([
			note("eighth", 0),
			note("eighth", 0.5),
			note("quarter", 1),
			note("sixteenth", 2),
			note("sixteenth", 2.25),
			note("eighth", 2.5),
		]);
		expect(groups.map((g) => g.length)).toEqual([2, 1, 3]);
	});

	it("keeps a lone eighth and a quarter as separate singletons", () => {
		const groups = beamGroups([note("eighth", 0), note("quarter", 1)]);
		expect(groups.map((g) => g.length)).toEqual([1, 1]);
	});
});

describe("beatToX (Phase 9 time-signature margin)", () => {
	const g = staffGeometry({ x: 0, y: 0, width: 600, lineSpacing: 10 });

	it("reserves the clef gap PLUS the time-signature gap before beat 0", () => {
		expect(beatToX(0, g)).toBe(
			g.x + g.lineSpacing * (CLEF_GAP_FACTOR + TIME_SIG_GAP),
		);
	});

	it("advances linearly by pixels-per-beat (margin shifts both staves equally)", () => {
		expect(beatToX(1, g) - beatToX(0, g)).toBe(
			g.lineSpacing * PIXELS_PER_BEAT_FACTOR,
		);
	});
});

describe("phraseEndBeat", () => {
	const phrase = (notes: Array<[NoteValue, number]>): Phrase => ({
		notes: notes.map(([noteValue, beatPosition]) => ({
			pitch: "C",
			accidental: null,
			octave: 4,
			noteValue,
			beatPosition,
		})),
		timeSignatureNumerator: 4,
		timeSignatureDenominator: 4,
		bpm: 90,
	});

	it("is 0 for an empty phrase", () => {
		expect(phraseEndBeat(phrase([]))).toBe(0);
	});

	it("returns the latest note end regardless of array order", () => {
		// half note at beat 4 ends at 6; the earlier quarter at 0 must not win.
		expect(
			phraseEndBeat(
				phrase([
					["half", 4],
					["quarter", 0],
				]),
			),
		).toBe(6);
	});
});

describe("measureBoundaries", () => {
	const fourFour = (endBeat: number): Phrase => ({
		// One whole-phrase-spanning note that ends exactly at endBeat.
		notes: [
			{
				pitch: "C",
				accidental: null,
				octave: 4,
				noteValue: "quarter",
				beatPosition: 0,
			},
			{
				pitch: "C",
				accidental: null,
				octave: 4,
				noteValue: "quarter",
				beatPosition: endBeat - 1,
			},
		],
		timeSignatureNumerator: 4,
		timeSignatureDenominator: 4,
		bpm: 90,
	});

	it("a 2-measure 4/4 phrase has one internal boundary at beat 4", () => {
		expect(measureBoundaries(fourFour(8))).toEqual([4]);
	});

	it("a single 4/4 measure has no internal boundaries", () => {
		expect(measureBoundaries(fourFour(4))).toEqual([]);
	});

	it("a 3-measure 4/4 phrase has boundaries at 4 and 8", () => {
		expect(measureBoundaries(fourFour(12))).toEqual([4, 8]);
	});

	it("respects a 3/4 time signature (boundaries every 3 beats)", () => {
		const waltz: Phrase = {
			notes: [
				{
					pitch: "C",
					accidental: null,
					octave: 4,
					noteValue: "quarter",
					beatPosition: 0,
				},
				{
					pitch: "C",
					accidental: null,
					octave: 4,
					noteValue: "quarter",
					beatPosition: 8,
				},
			],
			timeSignatureNumerator: 3,
			timeSignatureDenominator: 4,
			bpm: 90,
		};
		expect(measureBoundaries(waltz)).toEqual([3, 6]);
	});

	it("is empty for an empty phrase", () => {
		expect(
			measureBoundaries({
				notes: [],
				timeSignatureNumerator: 4,
				timeSignatureDenominator: 4,
				bpm: 90,
			}),
		).toEqual([]);
	});
});

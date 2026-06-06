import { describe, expect, it } from "vitest";
import { fixturePhrase } from "../../tests/fixtures/fixture-phrase";
import type { Chord } from "../dsp/harmony";
import type { NoteName, NoteValue, Phrase } from "../dsp/quantize";
import { voiceChord } from "../dsp/voicing";
import {
	bassStaffGeometry,
	beatToX,
	notePosition,
	notePositionBass,
	staffGeometry,
} from "./layout";
import { phraseToSVG } from "./render";
import type { SVGElementSpec } from "./types";

const geom = staffGeometry({ x: 0, y: 0, width: 300, lineSpacing: 10 });
const hasClass = (s: SVGElementSpec, c: string): boolean =>
	s.className?.split(" ").includes(c) ?? false;

describe("phraseToSVG (fixture: C4 q, E4 q, G4 h)", () => {
	const specs = phraseToSVG(fixturePhrase, geom);

	it("draws exactly 5 staff lines", () => {
		expect(specs.filter((s) => hasClass(s, "staff-line"))).toHaveLength(5);
	});

	it("draws one treble clef as a single drawn path", () => {
		const clef = specs.filter((s) => hasClass(s, "clef"));
		expect(clef).toHaveLength(1);
		expect(clef[0].kind).toBe("path");
	});

	it("draws 3 noteheads at the correct staff-y positions", () => {
		const heads = specs.filter((s) => hasClass(s, "notehead"));
		expect(heads).toHaveLength(3);
		expect(heads.map((h) => h.attrs.cy)).toEqual(
			fixturePhrase.notes.map((n) => notePosition(n, geom)),
		);
	});

	it("renders the half note (G4) as a single open notehead", () => {
		expect(specs.filter((s) => hasClass(s, "notehead--open"))).toHaveLength(1);
	});

	it("puts a stem on every non-whole note and no beam", () => {
		expect(specs.filter((s) => hasClass(s, "stem"))).toHaveLength(3);
		expect(specs.filter((s) => hasClass(s, "beam"))).toHaveLength(0);
	});

	it("draws a ledger line for middle C below the staff", () => {
		expect(
			specs.filter((s) => hasClass(s, "ledger-line")).length,
		).toBeGreaterThanOrEqual(1);
	});
});

describe("chord symbols", () => {
	const geomChords = staffGeometry({
		x: 0,
		y: 40,
		width: 300,
		lineSpacing: 10,
	});

	// A small inline Chord[] — two chords at beat 0 and beat 2.
	const testChords: Chord[] = [
		{
			roman: "I",
			degree: 1,
			quality: "major",
			root: { pitch: "C", accidental: null },
			tones: [
				{ pitch: "C", accidental: null },
				{ pitch: "E", accidental: null },
				{ pitch: "G", accidental: null },
			],
			symbol: "C",
			beatPosition: 0,
			beats: 2,
		},
		{
			roman: "V",
			degree: 5,
			quality: "major",
			root: { pitch: "G", accidental: null },
			tones: [
				{ pitch: "G", accidental: null },
				{ pitch: "B", accidental: null },
				{ pitch: "D", accidental: null },
			],
			symbol: "G",
			beatPosition: 2,
			beats: 2,
		},
	];

	it("appends exactly one chord-symbol spec per chord when chords provided", () => {
		const specs = phraseToSVG(fixturePhrase, geomChords, testChords);
		const symbols = specs.filter((s) => hasClass(s, "chord-symbol"));
		expect(symbols).toHaveLength(2);
	});

	it("each chord-symbol spec has x === beatToX(chord.beatPosition, geom)", () => {
		const specs = phraseToSVG(fixturePhrase, geomChords, testChords);
		const symbols = specs.filter((s) => hasClass(s, "chord-symbol"));
		expect(symbols[0].attrs.x).toBe(
			Math.round(beatToX(testChords[0].beatPosition, geomChords) * 100) / 100,
		);
		expect(symbols[1].attrs.x).toBe(
			Math.round(beatToX(testChords[1].beatPosition, geomChords) * 100) / 100,
		);
	});

	it("each chord-symbol spec text matches chord.symbol", () => {
		const specs = phraseToSVG(fixturePhrase, geomChords, testChords);
		const symbols = specs.filter((s) => hasClass(s, "chord-symbol"));
		expect(symbols[0].text).toBe("C");
		expect(symbols[1].text).toBe("G");
	});

	it("chord-symbol specs have reveal:'frame'", () => {
		const specs = phraseToSVG(fixturePhrase, geomChords, testChords);
		const symbols = specs.filter((s) => hasClass(s, "chord-symbol"));
		expect(symbols.every((s) => s.reveal === "frame")).toBe(true);
	});

	it("left-anchors chord symbols that comfortably fit before the right edge", () => {
		// testChords sit at beats 0 and 2 — nowhere near the right viewBox edge.
		const specs = phraseToSVG(fixturePhrase, geomChords, testChords);
		const symbols = specs.filter((s) => hasClass(s, "chord-symbol"));
		expect(symbols.every((s) => s.attrs.textAnchor === "start")).toBe(true);
	});

	it("end-anchors a chord symbol near the right edge so it stays on-page", () => {
		// A chord far to the right: a left-anchored label would spill past the
		// viewBox, so it should anchor at its end and grow leftward instead.
		const rightChord: Chord[] = [{ ...testChords[0], beatPosition: 8 }];
		const specs = phraseToSVG(fixturePhrase, geomChords, rightChord);
		const symbol = specs.find((s) => hasClass(s, "chord-symbol"));
		expect(symbol?.attrs.textAnchor).toBe("end");
	});

	it("omitting chords produces ZERO chord-symbol specs; one per chord when present", () => {
		const withoutChords = phraseToSVG(fixturePhrase, geomChords);
		const withChords = phraseToSVG(fixturePhrase, geomChords, testChords);
		expect(
			withoutChords.filter((s) => hasClass(s, "chord-symbol")),
		).toHaveLength(0);
		// In Phase 6 chords also add the bass staff, so compare symbol counts —
		// not total spec counts — to assert exactly one symbol per chord.
		expect(withChords.filter((s) => hasClass(s, "chord-symbol"))).toHaveLength(
			testChords.length,
		);
	});
});

describe("grand staff engraving (Phase 6)", () => {
	const geomGrand = staffGeometry({ x: 0, y: 40, width: 300, lineSpacing: 10 });
	const bassGeom = bassStaffGeometry(geomGrand);

	// I (C) at beat 0, V (G) at beat 2.
	const chords: Chord[] = [
		{
			roman: "I",
			degree: 1,
			quality: "major",
			root: { pitch: "C", accidental: null },
			tones: [
				{ pitch: "C", accidental: null },
				{ pitch: "E", accidental: null },
				{ pitch: "G", accidental: null },
			],
			symbol: "C",
			beatPosition: 0,
			beats: 2,
		},
		{
			roman: "V",
			degree: 5,
			quality: "major",
			root: { pitch: "G", accidental: null },
			tones: [
				{ pitch: "G", accidental: null },
				{ pitch: "B", accidental: null },
				{ pitch: "D", accidental: null },
			],
			symbol: "G",
			beatPosition: 2,
			beats: 2,
		},
	];

	const specs = phraseToSVG(fixturePhrase, geomGrand, chords);

	it("adds a second staff: 10 staff lines total (treble + bass)", () => {
		expect(specs.filter((s) => hasClass(s, "staff-line"))).toHaveLength(10);
	});

	it("draws a single brace joining the two staves", () => {
		const braces = specs.filter((s) => hasClass(s, "brace"));
		expect(braces).toHaveLength(1);
		expect(braces[0].kind).toBe("path");
	});

	it("draws a bass clef (path + two dots) below the treble clef", () => {
		expect(specs.filter((s) => hasClass(s, "clef"))).toHaveLength(2); // treble + bass
		expect(specs.filter((s) => hasClass(s, "clef-dot"))).toHaveLength(2);
	});

	it("engraves one bass note (root) per chord", () => {
		expect(specs.filter((s) => hasClass(s, "bass-note"))).toHaveLength(
			chords.length,
		);
	});

	it("engraves a three-note triad stack per chord", () => {
		expect(specs.filter((s) => hasClass(s, "chord-tone"))).toHaveLength(
			3 * chords.length,
		);
	});

	it("places chord tones at their voiced bass-staff y-positions", () => {
		// The first chord's triad tones, voiced and mapped through the bass ruler.
		const voiced = voiceChord(chords[0]);
		const expectedCys = voiced.triad
			.map((t) => Math.round(notePositionBass(t, bassGeom) * 100) / 100)
			.sort((a, b) => a - b);
		const x0 =
			Math.round(beatToX(chords[0].beatPosition, geomGrand) * 100) / 100;
		const actualCys = specs
			.filter((s) => hasClass(s, "chord-tone") && s.attrs.cx === x0)
			.map((s) => Number(s.attrs.cy))
			.sort((a, b) => a - b);
		expect(actualCys).toEqual(expectedCys);
	});

	it("aligns each chord stack to its beat x (shared beatToX with the melody)", () => {
		const x1 =
			Math.round(beatToX(chords[1].beatPosition, geomGrand) * 100) / 100;
		const stackHeads = specs.filter(
			(s) =>
				(hasClass(s, "chord-tone") || hasClass(s, "bass-note")) &&
				s.attrs.cx === x1,
		);
		expect(stackHeads).toHaveLength(4); // bass note + 3 triad tones
	});

	it("renders NO bass staff when chords are omitted (v1 single-staff path)", () => {
		const single = phraseToSVG(fixturePhrase, geomGrand);
		expect(single.filter((s) => hasClass(s, "staff-line"))).toHaveLength(5);
		expect(single.filter((s) => hasClass(s, "brace"))).toHaveLength(0);
		expect(single.filter((s) => hasClass(s, "clef-dot"))).toHaveLength(0);
		expect(single.filter((s) => hasClass(s, "bass-note"))).toHaveLength(0);
		expect(single.filter((s) => hasClass(s, "chord-tone"))).toHaveLength(0);
	});
});

describe("stem direction (relative to the middle line, B4)", () => {
	const single = (
		pitch: NoteName,
		octave: number,
		noteValue: NoteValue = "quarter",
	): Phrase => ({
		notes: [{ pitch, accidental: null, octave, noteValue, beatPosition: 0 }],
		timeSignatureNumerator: 4,
		timeSignatureDenominator: 4,
		bpm: 90,
	});
	const find = (phrase: Phrase, cls: string): SVGElementSpec => {
		const spec = phraseToSVG(phrase, geom).find((s) => hasClass(s, cls));
		if (!spec) throw new Error(`no ${cls} spec`);
		return spec;
	};

	it("points the stem up (tip above the head) for notes below B4", () => {
		const low = single("C", 4);
		expect(Number(find(low, "stem").attrs.y2)).toBeLessThan(
			Number(find(low, "notehead").attrs.cy),
		);
	});

	it("points the stem down (tip below the head) for notes above B4", () => {
		const high = single("D", 5);
		expect(Number(find(high, "stem").attrs.y2)).toBeGreaterThan(
			Number(find(high, "notehead").attrs.cy),
		);
	});
});

import { describe, expect, it } from "vitest";
import { fixturePhrase } from "../../tests/fixtures/fixture-phrase";
import type { NoteName, NoteValue, Phrase } from "../dsp/quantize";
import { notePosition, staffGeometry } from "./layout";
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

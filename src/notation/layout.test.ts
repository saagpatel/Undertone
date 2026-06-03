import { describe, expect, it } from "vitest";
import type { NoteEvent, NoteName, NoteValue } from "../dsp/quantize";
import {
	beamGroups,
	diatonicValue,
	notePosition,
	staffGeometry,
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

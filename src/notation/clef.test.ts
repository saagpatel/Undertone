import { describe, expect, it } from "vitest";
import { bassClef, brace, timeSignature, trebleClef } from "./clef";
import {
	bassStaffGeometry,
	CLEF_GAP_FACTOR,
	notePositionBass,
	staffGeometry,
	TIME_SIG_GAP,
} from "./layout";

const geom = staffGeometry({ x: 28, y: 72, width: 520, lineSpacing: 13 });

/** Pull the y-value out of every "x y" coordinate pair in a path's `d`. */
const pathYs = (d: string): number[] =>
	(d.match(/-?\d+(?:\.\d+)?\s+(-?\d+(?:\.\d+)?)/g) ?? []).map((pair) =>
		Number(pair.trim().split(/\s+/)[1]),
	);

describe("trebleClef", () => {
	const clef = trebleClef(geom);

	it("is a single unfilled path tagged as the clef", () => {
		expect(clef.kind).toBe("path");
		expect(clef.className).toBe("clef");
		expect(clef.attrs.fill).toBe("none");
	});

	it("emits a continuous path: one move, no second subpath", () => {
		const d = String(clef.attrs.d);
		expect((d.match(/M/g) ?? []).length).toBe(1);
		expect(d).toMatch(/^M/);
	});

	it("contains only finite coordinates (no NaN/undefined)", () => {
		const d = String(clef.attrs.d);
		expect(d).not.toMatch(/NaN|undefined/);
		const numbers = d.match(/-?\d+(\.\d+)?/g) ?? [];
		expect(numbers.length).toBeGreaterThan(0);
		for (const n of numbers) expect(Number.isFinite(Number(n))).toBe(true);
	});

	it("scales with the staff: a larger line spacing yields a taller clef", () => {
		const yOf = (d: string): number[] =>
			(d.match(/-?\d+(?:\.\d+)?\s+(-?\d+(?:\.\d+)?)/g) ?? []).map((pair) =>
				Number(pair.trim().split(/\s+/)[1]),
			);
		const small = yOf(String(trebleClef(geom).attrs.d));
		const big = yOf(String(trebleClef({ ...geom, lineSpacing: 26 }).attrs.d));
		const span = (ys: number[]): number => Math.max(...ys) - Math.min(...ys);
		expect(span(big)).toBeGreaterThan(span(small));
	});
});

describe("bassClef", () => {
	const bass = bassStaffGeometry(geom);
	const specs = bassClef(bass);

	it("returns a single curl path plus two dots", () => {
		expect(specs).toHaveLength(3);
		expect(specs[0].kind).toBe("path");
		expect(specs[0].attrs.fill).toBe("none");
		expect(specs.filter((s) => s.kind === "ellipse")).toHaveLength(2);
	});

	it("places the two dots straddling the F3 line", () => {
		const f3 = notePositionBass({ pitch: "F", octave: 3 }, bass);
		const dotYs = specs
			.filter((s) => s.kind === "ellipse")
			.map((s) => Number(s.attrs.cy))
			.sort((a, b) => a - b);
		expect(dotYs[0]).toBeLessThan(f3); // one in the space above F3
		expect(dotYs[1]).toBeGreaterThan(f3); // one in the space below F3
	});

	it("fills the dots so they read as ink (not unfilled like the path)", () => {
		for (const dot of specs.filter((s) => s.kind === "ellipse")) {
			expect(dot.attrs.fill).not.toBe("none");
		}
	});

	it("emits a continuous path with finite coordinates and one move", () => {
		const d = String(specs[0].attrs.d);
		expect(d).not.toMatch(/NaN|undefined/);
		expect((d.match(/M/g) ?? []).length).toBe(1);
		for (const y of pathYs(d)) expect(Number.isFinite(y)).toBe(true);
	});

	it("scales with the staff: a larger line spacing yields a taller clef", () => {
		const span = (ys: number[]): number => Math.max(...ys) - Math.min(...ys);
		const small = bassClef(bass);
		const big = bassClef(bassStaffGeometry({ ...geom, lineSpacing: 26 }));
		expect(span(pathYs(String(big[0].attrs.d)))).toBeGreaterThan(
			span(pathYs(String(small[0].attrs.d))),
		);
	});
});

describe("brace", () => {
	const bass = bassStaffGeometry(geom);
	const b = brace(geom, bass);

	it("is a single unfilled path on the left of the system", () => {
		expect(b.kind).toBe("path");
		expect(b.attrs.fill).toBe("none");
		expect(b.className).toBe("brace");
		expect((String(b.attrs.d).match(/M/g) ?? []).length).toBe(1);
	});

	it("spans from the treble top line to the bass bottom line", () => {
		const ys = pathYs(String(b.attrs.d));
		const bassBottom = bass.y + (bass.numLines - 1) * bass.lineSpacing;
		expect(Math.min(...ys)).toBeLessThanOrEqual(geom.y + 1);
		expect(Math.max(...ys)).toBeGreaterThanOrEqual(bassBottom - 1);
	});

	it("sits to the left of the staff's left edge", () => {
		const xs = (String(b.attrs.d).match(/[ML]\s*(-?\d+(?:\.\d+)?)/g) ?? []).map(
			(m) => Number(m.replace(/[ML]\s*/, "")),
		);
		for (const x of xs) expect(x).toBeLessThanOrEqual(geom.x);
	});
});

describe("timeSignature", () => {
	const specs = timeSignature(geom, 4, 4);

	it("returns two stacked text digits", () => {
		expect(specs).toHaveLength(2);
		for (const s of specs) {
			expect(s.kind).toBe("text");
			expect(s.className).toBe("time-sig");
		}
	});

	it("renders the numerator over the denominator", () => {
		const [num, den] = specs;
		expect(num.text).toBe("4");
		expect(den.text).toBe("4");
		expect(Number(num.attrs.y)).toBeLessThan(Number(den.attrs.y)); // numerator is higher
	});

	it("reflects the actual meter (3/4)", () => {
		const [num, den] = timeSignature(geom, 3, 4);
		expect(num.text).toBe("3");
		expect(den.text).toBe("4");
	});

	it("centres both digits on one x in the reserved time-sig gap, after the clef", () => {
		const [num, den] = specs;
		const clefEdge = geom.x + geom.lineSpacing * CLEF_GAP_FACTOR;
		const beatZero =
			geom.x + geom.lineSpacing * (CLEF_GAP_FACTOR + TIME_SIG_GAP);
		expect(num.attrs.x).toBe(den.attrs.x);
		expect(Number(num.attrs.x)).toBeGreaterThan(clefEdge);
		expect(Number(num.attrs.x)).toBeLessThan(beatZero);
		for (const s of specs) expect(s.attrs.textAnchor).toBe("middle");
	});

	it("scales the digit height with line spacing", () => {
		const small = timeSignature(staffGeometry({ lineSpacing: 10 }), 4, 4)[0];
		const large = timeSignature(staffGeometry({ lineSpacing: 20 }), 4, 4)[0];
		expect(Number(large.attrs.fontSize)).toBeGreaterThan(
			Number(small.attrs.fontSize),
		);
	});
});

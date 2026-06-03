import { describe, expect, it } from "vitest";
import { trebleClef } from "./clef";
import { staffGeometry } from "./layout";

const geom = staffGeometry({ x: 28, y: 72, width: 520, lineSpacing: 13 });

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

import { describe, expect, it } from "vitest";
import { accidentalFor } from "./accidentals";

describe("accidentalFor", () => {
	it("returns null for a natural", () => {
		expect(accidentalFor(null, 0, 0, 10)).toBeNull();
	});

	it("builds a sharp as a non-empty stroked path", () => {
		const spec = accidentalFor("sharp", 100, 50, 10);
		expect(spec).not.toBeNull();
		expect(spec?.kind).toBe("path");
		expect(spec?.className).toContain("sharp");
		expect(typeof spec?.attrs.d).toBe("string");
		expect(String(spec?.attrs.d).length).toBeGreaterThan(0);
		expect(spec?.attrs.fill).toBe("none");
	});

	it("builds a flat as a non-empty stroked path", () => {
		const spec = accidentalFor("flat", 100, 50, 10);
		expect(spec?.kind).toBe("path");
		expect(spec?.className).toContain("flat");
		expect(String(spec?.attrs.d).length).toBeGreaterThan(0);
	});
});

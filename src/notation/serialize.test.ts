import { describe, expect, it } from "vitest";
import { fixturePhrase } from "../../tests/fixtures/fixture-phrase";
import { staffGeometry } from "./layout";
import { serializeElement, serializePhraseSVG } from "./serialize";
import type { SVGElementSpec } from "./types";

const geom = staffGeometry({ x: 28, y: 72, width: 520, lineSpacing: 13 });

describe("serializeElement", () => {
	it("kebab-cases camelCase attribute names (fontSize → font-size)", () => {
		const spec: SVGElementSpec = {
			kind: "text",
			attrs: { x: 1, y: 2, fontSize: 20 },
			text: "x",
		};
		const out = serializeElement(spec);
		expect(out).toContain('font-size="20"');
		expect(out).not.toContain("fontSize");
	});

	it("XML-escapes text content and attribute values", () => {
		const spec: SVGElementSpec = {
			kind: "text",
			attrs: { x: 0, y: 0 },
			text: "A & <B>",
		};
		expect(serializeElement(spec)).toContain("A &amp; &lt;B&gt;");
	});

	it("inlines per-class presentation attributes from the stylesheet", () => {
		const stem: SVGElementSpec = {
			kind: "line",
			attrs: { x1: 0, y1: 0, x2: 0, y2: 10 },
			className: "stem",
		};
		expect(serializeElement(stem)).toContain('stroke="#1a1208"');
		expect(serializeElement(stem)).toContain('stroke-width="1.6"');
	});

	it("resolves currentColor to a concrete ink value", () => {
		const head: SVGElementSpec = {
			kind: "ellipse",
			attrs: { cx: 0, cy: 0, rx: 4, ry: 3, fill: "currentColor" },
			className: "notehead",
		};
		const out = serializeElement(head);
		expect(out).toContain('fill="#1a1208"');
		expect(out).not.toContain("currentColor");
	});

	it("emits open noteheads as unfilled with a heavier stroke", () => {
		const open: SVGElementSpec = {
			kind: "ellipse",
			attrs: { cx: 0, cy: 0, rx: 4, ry: 3, fill: "none" },
			className: "notehead notehead--open",
		};
		const out = serializeElement(open);
		expect(out).toContain('fill="none"');
		expect(out).toContain('stroke-width="1.8"');
	});
});

describe("serializePhraseSVG", () => {
	const svg = serializePhraseSVG(fixturePhrase, geom);

	it("starts with an XML prolog and declares the SVG namespace", () => {
		expect(svg.startsWith("<?xml")).toBe(true);
		expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
	});

	it("produces well-formed XML the browser parser accepts", () => {
		const doc = new DOMParser().parseFromString(svg, "image/svg+xml");
		expect(doc.querySelector("parsererror")).toBeNull();
		expect(doc.documentElement.nodeName).toBe("svg");
	});

	it("carries the full notation: 5 staff lines and a notehead per note", () => {
		const count = (re: RegExp): number => (svg.match(re) ?? []).length;
		expect(count(/class="staff-line"/g)).toBe(5);
		expect(count(/class="notehead\b/g)).toBe(fixturePhrase.notes.length);
	});

	it("embeds the paper background and the ink-irregularity filter", () => {
		expect(svg).toContain("#f8f4ec");
		expect(svg).toContain("feTurbulence");
		expect(svg).toContain('filter="url(#undertone-ink)"');
	});
});

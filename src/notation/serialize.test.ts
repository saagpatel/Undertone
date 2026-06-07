import { describe, expect, it } from "vitest";
import { fixturePhrase } from "../../tests/fixtures/fixture-phrase";
import type { Chord } from "../dsp/harmony";
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

	it("without chords, output is unchanged (no chord-symbol element)", () => {
		expect(svg).not.toContain('class="chord-symbol"');
	});
});

describe("serializePhraseSVG with chords", () => {
	const chordGeom = staffGeometry({
		x: 28,
		y: 72,
		width: 520,
		lineSpacing: 13,
	});

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
			roman: "IV",
			degree: 4,
			quality: "major",
			root: { pitch: "F", accidental: null },
			tones: [
				{ pitch: "F", accidental: null },
				{ pitch: "A", accidental: null },
				{ pitch: "C", accidental: null },
			],
			symbol: "F",
			beatPosition: 2,
			beats: 2,
		},
	];

	const svgWithChords = serializePhraseSVG(
		fixturePhrase,
		chordGeom,
		testChords,
	);

	it('contains a <text class="chord-symbol" for each chord', () => {
		const matches = svgWithChords.match(/class="chord-symbol"/g) ?? [];
		expect(matches).toHaveLength(2);
	});

	it("chord-symbol elements contain the chord symbol text", () => {
		expect(svgWithChords).toContain(">C<");
		expect(svgWithChords).toContain(">F<");
	});

	it("chord-symbol elements carry an explicit fill attribute", () => {
		// Every <text class="chord-symbol"> must have a fill attr so text is
		// visible inside the <g fill="none"> wrapper.
		const chordEls =
			svgWithChords.match(/<text[^>]*class="chord-symbol"[^>]*>/g) ?? [];
		expect(chordEls).toHaveLength(2);
		for (const el of chordEls) {
			expect(el).toContain("fill=");
		}
	});

	it("document still parses as valid XML when chords are included", () => {
		const doc = new DOMParser().parseFromString(svgWithChords, "image/svg+xml");
		expect(doc.querySelector("parsererror")).toBeNull();
		expect(doc.documentElement.nodeName).toBe("svg");
	});
});

describe("export presentation for Phase 9 glyphs", () => {
	it("inlines a stroke on barlines so they show in the bare file", () => {
		const out = serializeElement({
			kind: "line",
			attrs: { x1: 0, y1: 0, x2: 0, y2: 10 },
			className: "barline",
		});
		expect(out).toContain('stroke="#1a1208"');
		expect(out).toContain('stroke-width="1.6"');
	});

	it("doubles the stroke weight on the final barline", () => {
		const out = serializeElement({
			kind: "line",
			attrs: { x1: 0, y1: 0, x2: 0, y2: 10 },
			className: "barline barline--final",
		});
		expect(out).toContain('stroke-width="4"');
	});

	it("inlines a fill on time-sig digits (else invisible under g fill=none)", () => {
		const out = serializeElement({
			kind: "text",
			text: "4",
			attrs: { x: 0, y: 0, fontSize: 20, fill: "currentColor" },
			className: "time-sig",
		});
		expect(out).toContain('fill="#1a1208"'); // currentColor pinned to ink
		expect(out).toContain('font-size="20"');
		expect(out).toContain(">4</text>");
	});
});

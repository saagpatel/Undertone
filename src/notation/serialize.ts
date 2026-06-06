import type { Phrase } from "../dsp/quantize";
import { phraseToSVG } from "./render";
import type { StaffGeometry, SVGElementSpec } from "./types";

/**
 * Serializes a {@link Phrase} to a standalone, self-contained SVG document
 * string suitable for download. Unlike <NotationCanvas>, which leans on
 * `notation.css` and React's attribute handling, the exported file carries
 * everything it needs to render anywhere: presentation attributes are inlined
 * per element, React-style camelCase attribute names are kebab-cased, and the
 * ink-displacement filter is embedded inline.
 */

/** Paper + ink, mirrored from `global.css` so the export stands on its own. */
const PAPER = "#f8f4ec";
const INK = "#1a1208";

/**
 * Per-class presentation attributes, mirrored from `notation.css`. Inlined into
 * each element so the file renders without an external stylesheet. Keep in sync
 * with `notation.css`; these are the small set of stable ink constants.
 */
const PRESENTATION: Record<string, Record<string, string | number>> = {
	"staff-line": { stroke: INK, "stroke-width": 1.4, "stroke-linecap": "round" },
	"ledger-line": {
		stroke: INK,
		"stroke-width": 1.4,
		"stroke-linecap": "round",
	},
	stem: { stroke: INK, "stroke-width": 1.6, "stroke-linecap": "round" },
	beam: { stroke: INK, "stroke-width": 5, "stroke-linecap": "round" },
	accidental: { stroke: INK, "stroke-width": 1.4, "stroke-linecap": "round" },
	notehead: { stroke: INK, "stroke-width": 0.6 },
	"notehead--open": { "stroke-width": 1.8 },
	clef: { stroke: INK, "stroke-width": 1.6, "stroke-linecap": "round" },
};

const XML_ESCAPES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
};

const escapeXML = (value: string): string =>
	value.replace(/[&<>"]/g, (ch) => XML_ESCAPES[ch]);

/** React/DOM camelCase (`fontSize`) → SVG kebab-case (`font-size`). */
const kebab = (key: string): string =>
	key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);

/** Resolve a spec's class names + attrs into final inline presentation attrs. */
function resolveAttrs(spec: SVGElementSpec): Record<string, string | number> {
	const merged: Record<string, string | number> = {};
	for (const cls of spec.className?.split(/\s+/).filter(Boolean) ?? []) {
		Object.assign(merged, PRESENTATION[cls]);
	}
	// Element attrs win over class defaults (e.g. a filled vs. open notehead).
	Object.assign(merged, spec.attrs);
	// `currentColor` has no inherited context in a bare file — pin it to ink.
	for (const key of Object.keys(merged)) {
		if (merged[key] === "currentColor") merged[key] = INK;
	}
	return merged;
}

/** Serialize one spec to an SVG element string with inlined presentation. */
export function serializeElement(spec: SVGElementSpec): string {
	const attrs = resolveAttrs(spec);
	const parts = Object.entries(attrs).map(
		([key, value]) => `${kebab(key)}="${escapeXML(String(value))}"`,
	);
	// Keep the class names in the export so the file self-documents its parts.
	if (spec.className) parts.unshift(`class="${escapeXML(spec.className)}"`);
	const body = parts.join(" ");
	if (spec.kind === "text") {
		return `<text ${body}>${escapeXML(spec.text ?? "")}</text>`;
	}
	return `<${spec.kind} ${body} />`;
}

const INK_FILTER = `<filter id="undertone-ink" x="-8%" y="-8%" width="116%" height="116%"><feTurbulence type="fractalNoise" baseFrequency="0.014" numOctaves="2" seed="7" result="noise" /><feDisplacementMap in="SourceGraphic" in2="noise" scale="2.4" /></filter>`;

/** Build a complete, standalone SVG document string for a phrase. */
export function serializePhraseSVG(
	phrase: Phrase,
	geom: StaffGeometry,
): string {
	const viewW = geom.x * 2 + geom.width;
	const viewH = geom.y * 2 + (geom.numLines - 1) * geom.lineSpacing;
	const elements = phraseToSVG(phrase, geom).map(serializeElement).join("");

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewW} ${viewH}" width="${viewW}" height="${viewH}" style="background:${PAPER}">`,
		`<defs>${INK_FILTER}</defs>`,
		`<g fill="none" filter="url(#undertone-ink)">${elements}</g>`,
		"</svg>",
	].join("\n");
}

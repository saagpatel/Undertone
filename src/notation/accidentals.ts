import type { Accidental } from "../dsp/quantize";
import type { SVGElementSpec } from "./types";

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * Build a sharp or flat as a single stroked <path>. Geometric approximation —
 * not a font glyph — so it inherits the hand-scored ink aesthetic. Positioned
 * with its vertical center at (x, y); size scales with the staff line spacing.
 * Returns null for a natural (no glyph drawn).
 */
export function accidentalFor(
	accidental: Accidental,
	x: number,
	y: number,
	lineSpacing: number,
): SVGElementSpec | null {
	if (accidental === null) return null;
	const s = lineSpacing;

	if (accidental === "sharp") {
		const dx = s * 0.26; // half-gap between the two verticals
		const h = s * 1.05; // half-height of the verticals
		const w = s * 0.5; // half-width of the cross-bars
		const yb = s * 0.4; // half-gap between the cross-bars
		const slant = s * 0.12;
		const d = [
			`M ${round(x - dx)} ${round(y - h)} L ${round(x - dx)} ${round(y + h)}`,
			`M ${round(x + dx)} ${round(y - h)} L ${round(x + dx)} ${round(y + h)}`,
			`M ${round(x - w)} ${round(y - yb + slant)} L ${round(x + w)} ${round(y - yb - slant)}`,
			`M ${round(x - w)} ${round(y + yb + slant)} L ${round(x + w)} ${round(y + yb - slant)}`,
		].join(" ");
		return {
			kind: "path",
			attrs: { d, fill: "none" },
			className: "accidental accidental--sharp",
		};
	}

	// Flat: a vertical stem with a bowl curving off its lower half.
	const top = y - s * 1.1;
	const stemX = x - s * 0.28;
	const d = [
		`M ${round(stemX)} ${round(top)} L ${round(stemX)} ${round(y + s * 0.55)}`,
		`C ${round(x + s * 0.55)} ${round(y - s * 0.05)} ${round(x + s * 0.55)} ${round(y + s * 0.65)} ${round(stemX)} ${round(y + s * 0.55)}`,
	].join(" ");
	return {
		kind: "path",
		attrs: { d, fill: "none" },
		className: "accidental accidental--flat",
	};
}

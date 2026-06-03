import type { StaffGeometry, SVGElementSpec } from "./types";

const round = (n: number): number => Math.round(n * 100) / 100;

/**
 * A treble (G) clef drawn as a single continuous stroke rather than a font
 * glyph, so it inherits the hand-scored ink aesthetic and the displacement
 * filter. The spiral's eye sits on the G4 line (the 4th staff line from the
 * top); the path is authored in staff-space units and scaled to the geometry.
 *
 * Drawn as one pen stroke: top terminal → outer loop → belly → spiral into the
 * eye → straight tail below the staff → terminal hook.
 */
export function trebleClef(geom: StaffGeometry): SVGElementSpec {
	const ls = geom.lineSpacing;
	const g4Y = geom.y + 3 * ls; // 4th line from top in treble = G4
	const cx = geom.x + ls * 1.35; // spine sits inside the reserved clef gap

	// Local coordinates: origin at the eye on G4, x → right, y → down, in `ls`.
	const p = (lx: number, ly: number): string =>
		`${round(cx + lx * ls)} ${round(g4Y + ly * ls)}`;

	const d = [
		`M ${p(0.1, -3.05)}`, // top terminal, above the staff
		`C ${p(0.85, -3.15)} ${p(1.05, -2.05)} ${p(0.18, -1.6)}`, // upper loop, back toward center
		`C ${p(-0.85, -1.15)} ${p(-1.0, 0.45)} ${p(0.1, 0.7)}`, // big belly sweeping down-left
		`C ${p(1.0, 0.92)} ${p(0.98, -0.3)} ${p(0.08, -0.42)}`, // up the right side toward the eye
		`C ${p(-0.48, -0.5)} ${p(-0.5, 0.22)} ${p(0.06, 0.16)}`, // the eye loop on G4
		`C ${p(0.3, 0.12)} ${p(0.18, 0.55)} ${p(0.1, 1.05)}`, // leave the eye into the tail
		`L ${p(0.04, 2.05)}`, // straight tail below the staff
		`C ${p(0.02, 2.45)} ${p(-0.42, 2.55)} ${p(-0.68, 2.18)}`, // terminal hook
	].join(" ");

	return { kind: "path", attrs: { d, fill: "none" }, className: "clef" };
}

import { CLEF_GAP_FACTOR, TIME_SIG_GAP } from "./layout";
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
		`C ${p(0.95, -3.18)} ${p(1.18, -2.05)} ${p(0.18, -1.58)}`, // upper loop, back toward center
		`C ${p(-1.05, -1.12)} ${p(-1.3, 0.55)} ${p(0.12, 0.82)}`, // big full belly sweeping down-left
		`C ${p(1.15, 1.02)} ${p(1.1, -0.3)} ${p(0.08, -0.42)}`, // up the right side toward the eye
		`C ${p(-0.48, -0.5)} ${p(-0.5, 0.22)} ${p(0.06, 0.16)}`, // the eye loop on G4
		`C ${p(0.3, 0.12)} ${p(0.18, 0.55)} ${p(0.1, 1.05)}`, // leave the eye into the tail
		`L ${p(0.04, 2.05)}`, // straight tail below the staff
		`C ${p(0.02, 2.45)} ${p(-0.42, 2.55)} ${p(-0.68, 2.18)}`, // terminal hook
	].join(" ");

	return { kind: "path", attrs: { d, fill: "none" }, className: "clef" };
}

/**
 * A bass (F) clef drawn as one continuous stroke plus the two dots that flank
 * the F3 line — same hand-scored treatment as the treble clef. The comma-shaped
 * head curls over the F3 line; the dots sit in the spaces just above and below
 * it. `geom` is the BASS staff geometry (top line A3), so F3 = `geom.y + ls`.
 */
export function bassClef(geom: StaffGeometry): SVGElementSpec[] {
	const ls = geom.lineSpacing;
	const f3Y = geom.y + ls; // 4th line up = F3, where the clef is anchored
	const cx = geom.x + ls * 1.1; // head sits inside the reserved clef gap

	// Local coordinates: origin at the F3 anchor, x → right, y → down, in `ls`.
	const p = (lx: number, ly: number): string =>
		`${round(cx + lx * ls)} ${round(f3Y + ly * ls)}`;

	// One pen stroke: a dot-like head on F3, curling up and over to the right,
	// then sweeping down-left into the comma tail near D3.
	const d = [
		`M ${p(-0.2, 0.1)}`, // start on F3, left of the head
		`C ${p(-0.3, -0.75)} ${p(0.7, -1.15)} ${p(1.15, -0.65)}`, // up and over the top toward A3
		`C ${p(1.55, -0.3)} ${p(1.45, 0.5)} ${p(1.0, 0.95)}`, // down the right side
		`C ${p(0.6, 1.35)} ${p(0.0, 1.4)} ${p(-0.5, 1.2)}`, // sweep down-left into the tail near D3
	].join(" ");

	const dotX = round(cx + ls * 1.75);
	const dotR = round(ls * 0.17);
	const dot = (ly: number): SVGElementSpec => ({
		kind: "ellipse",
		attrs: {
			cx: dotX,
			cy: round(f3Y + ly * ls),
			rx: dotR,
			ry: dotR,
			fill: "currentColor",
		},
		className: "clef-dot",
	});

	return [
		{ kind: "path", attrs: { d, fill: "none" }, className: "clef" },
		dot(-0.5), // space above F3 (G3)
		dot(0.5), // space below F3 (E3)
	];
}

/**
 * The grand-staff brace: a curly bracket on the far left joining the treble and
 * bass staves. Two mirrored bézier lobes that bulge left and pinch at the
 * vertical midpoint, spanning the treble top line to the bass bottom line.
 */
export function brace(
	treble: StaffGeometry,
	bass: StaffGeometry,
): SVGElementSpec {
	const ls = treble.lineSpacing;
	const topY = treble.y;
	const bottomY = bass.y + (bass.numLines - 1) * ls;
	const midY = (topY + bottomY) / 2;
	const x = treble.x - ls * 0.9; // anchor just left of the staff
	const bulge = ls * 0.9;

	const d = [
		`M ${round(x)} ${round(topY)}`,
		// upper lobe: bow out to the left, narrow back in to the cusp at midY
		`C ${round(x - bulge)} ${round(topY + (midY - topY) * 0.4)} ${round(
			x - bulge * 0.5,
		)} ${round(midY - (midY - topY) * 0.25)} ${round(x - bulge * 1.5)} ${round(
			midY,
		)}`,
		// lower lobe: mirror back out and in to the bass bottom line
		`C ${round(x - bulge * 0.5)} ${round(midY + (bottomY - midY) * 0.25)} ${round(
			x - bulge,
		)} ${round(bottomY - (bottomY - midY) * 0.4)} ${round(x)} ${round(bottomY)}`,
	].join(" ");

	return { kind: "path", attrs: { d, fill: "none" }, className: "brace" };
}

/**
 * A hand-scored time signature: two stacked digits placed in the reserved
 * {@link TIME_SIG_GAP} just after the clef. The numerator is centred in the top
 * half of the staff and the denominator in the bottom half; both scale with the
 * line spacing. Rendered as serif text (like the chord symbols) — the digits
 * carry an explicit `fontSize` so the canvas and the standalone export size them
 * identically from the same geometry.
 */
export function timeSignature(
	geom: StaffGeometry,
	numerator: number,
	denominator: number,
): SVGElementSpec[] {
	const ls = geom.lineSpacing;
	// Centre of the time-sig gap, between the clef and beat 0.
	const x = round(geom.x + ls * (CLEF_GAP_FACTOR + TIME_SIG_GAP / 2));
	const fontSize = round(ls * 1.9); // ≈ two staff spaces tall, per convention

	const digit = (value: number, cy: number): SVGElementSpec => ({
		kind: "text",
		text: String(value),
		attrs: {
			x,
			y: round(cy),
			textAnchor: "middle",
			dominantBaseline: "central",
			fontSize,
			fill: "currentColor",
		},
		className: "time-sig",
	});

	return [
		digit(numerator, geom.y + ls), // top half: between the top line and the middle
		digit(denominator, geom.y + 3 * ls), // bottom half: between the middle and bottom line
	];
}

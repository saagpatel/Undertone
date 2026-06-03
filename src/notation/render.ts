import type { Phrase } from "../dsp/quantize";
import { accidentalFor } from "./accidentals";
import { trebleClef } from "./clef";
import { beamGroups, isBeamable, notePosition } from "./layout";
import type { StaffGeometry, SVGElementSpec } from "./types";

const CLEF_GAP_FACTOR = 4; // staff spaces reserved for the clef before note 1
const PIXELS_PER_BEAT_FACTOR = 3.2; // horizontal spread per quarter-note beat
const STEM_LENGTH_FACTOR = 3.5;
const NOTEHEAD_RX_FACTOR = 0.7;
const NOTEHEAD_RY_FACTOR = 0.5; // rx/ry ≈ 1.4 → wider than tall
const NOTEHEAD_TILT_DEG = -15;

const round = (n: number): number => Math.round(n * 100) / 100;
const isOpenHead = (phrase: Phrase["notes"][number]): boolean =>
	phrase.noteValue === "half" || phrase.noteValue === "whole";

/**
 * Render a quantized {@link Phrase} into framework-agnostic SVG primitives:
 * staff, clef, ledger lines, accidentals, noteheads, stems, and beams.
 */
export function phraseToSVG(
	phrase: Phrase,
	geom: StaffGeometry,
): SVGElementSpec[] {
	const specs: SVGElementSpec[] = [];
	const ls = geom.lineSpacing;
	const rx = ls * NOTEHEAD_RX_FACTOR;
	const ry = ls * NOTEHEAD_RY_FACTOR;
	const topLineY = geom.y;
	const bottomLineY = geom.y + (geom.numLines - 1) * ls;
	const middleLineY = geom.y + ((geom.numLines - 1) / 2) * ls;

	const leftMargin = geom.x + ls * CLEF_GAP_FACTOR;
	const pxPerBeat = ls * PIXELS_PER_BEAT_FACTOR;
	const noteX = (beatPosition: number): number =>
		leftMargin + beatPosition * pxPerBeat;
	const stemUpAt = (cy: number): boolean => cy > middleLineY; // below middle line → stem up

	// 1. Staff lines (revealed with the clef as one "frame" that fades in).
	for (let i = 0; i < geom.numLines; i++) {
		const y = round(geom.y + i * ls);
		specs.push({
			kind: "line",
			attrs: { x1: geom.x, y1: y, x2: geom.x + geom.width, y2: y },
			className: "staff-line",
			reveal: "frame",
		});
	}

	// 2. Treble clef (a drawn path, not a font glyph).
	specs.push({ ...trebleClef(geom), reveal: "frame" });

	// 3. Per-note: ledger lines, accidental, notehead, stem. Each note's glyphs
	//    share its index so the reveal animation staggers them in playing order.
	phrase.notes.forEach((note, index) => {
		const cx = noteX(note.beatPosition);
		const cy = notePosition(note, geom);
		const noteSpecs: SVGElementSpec[] = [];

		noteSpecs.push(...ledgerLines(cx, cy, rx, ls, topLineY, bottomLineY));

		const accidental = accidentalFor(
			note.accidental,
			cx - rx - ls * 0.55,
			cy,
			ls,
		);
		if (accidental) {
			accidental.attrs.pathLength = 1;
			noteSpecs.push(accidental);
		}

		const open = isOpenHead(note);
		noteSpecs.push({
			kind: "ellipse",
			attrs: {
				cx: round(cx),
				cy: round(cy),
				rx: round(rx),
				ry: round(ry),
				transform: `rotate(${NOTEHEAD_TILT_DEG} ${round(cx)} ${round(cy)})`,
				fill: open ? "none" : "currentColor",
			},
			className: open ? "notehead notehead--open" : "notehead",
		});

		// Whole notes carry no stem; everything else does.
		if (note.noteValue !== "whole") {
			const up = stemUpAt(cy);
			const sx = round(up ? cx + rx * 0.9 : cx - rx * 0.9);
			const tipY = round(
				up ? cy - ls * STEM_LENGTH_FACTOR : cy + ls * STEM_LENGTH_FACTOR,
			);
			noteSpecs.push({
				kind: "line",
				attrs: { x1: sx, y1: round(cy), x2: sx, y2: tipY, pathLength: 1 },
				className: "stem",
			});
		}

		for (const spec of noteSpecs) spec.reveal = index;
		specs.push(...noteSpecs);
	});

	// 4. Beams: one straight beam across each beamable run of 2+ notes. The beam
	//    reveals with its last note so it draws after the heads it connects.
	for (const group of beamGroups(phrase.notes)) {
		if (group.length < 2 || !isBeamable(group[0].noteValue)) continue;
		const tips = group.map((note) => {
			const cx = noteX(note.beatPosition);
			const cy = notePosition(note, geom);
			const up = stemUpAt(cy);
			return {
				x: round(up ? cx + rx * 0.9 : cx - rx * 0.9),
				y: round(
					up ? cy - ls * STEM_LENGTH_FACTOR : cy + ls * STEM_LENGTH_FACTOR,
				),
			};
		});
		const first = tips[0];
		const last = tips[tips.length - 1];
		const lastIndex = group.reduce(
			(max, note) => Math.max(max, phrase.notes.indexOf(note)),
			0,
		);
		specs.push({
			kind: "line",
			attrs: {
				x1: first.x,
				y1: first.y,
				x2: last.x,
				y2: last.y,
				pathLength: 1,
			},
			className: "beam",
			reveal: lastIndex,
		});
	}

	return specs;
}

/** Short horizontal ledger lines for notes that fall outside the staff. */
function ledgerLines(
	cx: number,
	cy: number,
	rx: number,
	ls: number,
	topLineY: number,
	bottomLineY: number,
): SVGElementSpec[] {
	const out: SVGElementSpec[] = [];
	const half = rx + ls * 0.35;
	const tolerance = ls * 0.25;

	if (cy > bottomLineY + tolerance) {
		for (let y = bottomLineY + ls; y <= cy + tolerance; y += ls) {
			out.push(ledger(cx, y, half));
		}
	} else if (cy < topLineY - tolerance) {
		for (let y = topLineY - ls; y >= cy - tolerance; y -= ls) {
			out.push(ledger(cx, y, half));
		}
	}

	return out;
}

function ledger(cx: number, y: number, half: number): SVGElementSpec {
	return {
		kind: "line",
		attrs: {
			x1: round(cx - half),
			y1: round(y),
			x2: round(cx + half),
			y2: round(y),
			pathLength: 1,
		},
		className: "ledger-line",
	};
}

import type { Chord } from "../dsp/harmony";
import type { Phrase } from "../dsp/quantize";
import { type VoicedTone, voiceChord } from "../dsp/voicing";
import { accidentalFor } from "./accidentals";
import { bassClef, brace, trebleClef } from "./clef";
import {
	bassStaffGeometry,
	beamGroups,
	beatToX,
	isBeamable,
	notePosition,
	notePositionBass,
} from "./layout";
import type { StaffGeometry, SVGElementSpec } from "./types";

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
 *
 * When `chords` is provided the output becomes a grand staff: the melody on the
 * treble staff plus chord-symbol labels, and below it a braced bass staff that
 * engraves each chord as a stem-down bass note (root) and a stem-up triad stack,
 * aligned to the same `beatToX` columns as the melody. With no chords the output
 * is the v1 single treble staff, unchanged.
 */
export function phraseToSVG(
	phrase: Phrase,
	geom: StaffGeometry,
	chords?: Chord[],
): SVGElementSpec[] {
	const specs: SVGElementSpec[] = [];
	const ls = geom.lineSpacing;
	const rx = ls * NOTEHEAD_RX_FACTOR;
	const ry = ls * NOTEHEAD_RY_FACTOR;
	const topLineY = geom.y;
	const bottomLineY = geom.y + (geom.numLines - 1) * ls;
	const middleLineY = geom.y + ((geom.numLines - 1) / 2) * ls;

	const noteX = (beatPosition: number): number => beatToX(beatPosition, geom);
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

	// 5. Chord symbols: one text label per chord, revealed with the frame so they
	//    appear before individual notes animate in. Placed above the top staff line.
	if (chords && chords.length > 0) {
		for (const chord of chords) {
			specs.push({
				kind: "text",
				text: chord.symbol,
				attrs: {
					x: round(beatToX(chord.beatPosition, geom)),
					y: round(geom.y - geom.lineSpacing * 1.6),
					textAnchor: "start",
				},
				className: "chord-symbol",
				reveal: "frame",
			});
		}

		// 6. Grand staff: a braced bass staff under the treble, engraving each
		//    chord's accompaniment aligned to the same beat columns.
		specs.push(...bassStaffSpecs(phrase, geom, chords, rx, ry));
	}

	return specs;
}

/**
 * Build the bass-staff half of a grand staff: the brace, the five bass lines,
 * the bass clef, and one engraved chord per {@link Chord}. The staff scaffolding
 * reveals with the `"frame"`; each chord's glyphs stagger in with the melody note
 * nearest its beat, so the accompaniment inks in alongside the tune.
 */
function bassStaffSpecs(
	phrase: Phrase,
	trebleGeom: StaffGeometry,
	chords: Chord[],
	rx: number,
	ry: number,
): SVGElementSpec[] {
	const geom = bassStaffGeometry(trebleGeom);
	const ls = geom.lineSpacing;
	const specs: SVGElementSpec[] = [];

	// Brace + bass staff lines + bass clef — the "frame", revealed as a unit.
	specs.push({ ...brace(trebleGeom, geom), reveal: "frame" });
	for (let i = 0; i < geom.numLines; i++) {
		const y = round(geom.y + i * ls);
		specs.push({
			kind: "line",
			attrs: { x1: geom.x, y1: y, x2: geom.x + geom.width, y2: y },
			className: "staff-line",
			reveal: "frame",
		});
	}
	for (const clefSpec of bassClef(geom))
		specs.push({ ...clefSpec, reveal: "frame" });

	// Reveal index of the melody note at or before a given beat, so each chord
	// stack inks in as the melody reaches it.
	const revealForBeat = (beat: number): number => {
		let index = 0;
		phrase.notes.forEach((note, i) => {
			if (note.beatPosition <= beat) index = i;
		});
		return index;
	};

	for (const chord of chords) {
		const cx = beatToX(chord.beatPosition, geom);
		const voiced = voiceChord(chord);
		const chordSpecs: SVGElementSpec[] = [];

		// Bass voice (root): its own stem, pointing DOWN (lower voice convention).
		const bassCy = toneHead(
			voiced.bass,
			cx,
			geom,
			rx,
			ry,
			"bass-note",
			chordSpecs,
		);
		chordSpecs.push(verticalStem([bassCy], cx, rx, ls, false));

		// Upper voice (triad): three heads sharing one stem, pointing UP.
		const triadCys = voiced.triad.map((tone) =>
			toneHead(tone, cx, geom, rx, ry, "chord-tone", chordSpecs),
		);
		if (triadCys.length > 0)
			chordSpecs.push(verticalStem(triadCys, cx, rx, ls, true));

		const reveal = revealForBeat(chord.beatPosition);
		for (const spec of chordSpecs) spec.reveal = reveal;
		specs.push(...chordSpecs);
	}

	return specs;
}

/**
 * Push a single bass-staff notehead (with ledger lines and accidental) for a
 * voiced tone into `out`, returning its vertical center. `extraClass` tags the
 * head as a `bass-note` or `chord-tone` for downstream styling and testing.
 */
function toneHead(
	tone: VoicedTone,
	cx: number,
	geom: StaffGeometry,
	rx: number,
	ry: number,
	extraClass: string,
	out: SVGElementSpec[],
): number {
	const ls = geom.lineSpacing;
	const topLineY = geom.y;
	const bottomLineY = geom.y + (geom.numLines - 1) * ls;
	const cy = notePositionBass(tone, geom);

	out.push(...ledgerLines(cx, cy, rx, ls, topLineY, bottomLineY));

	const accidental = accidentalFor(
		tone.accidental,
		cx - rx - ls * 0.55,
		cy,
		ls,
	);
	if (accidental) {
		accidental.attrs.pathLength = 1;
		out.push(accidental);
	}

	// Chord noteheads are always filled (the accompaniment is rhythmically neutral).
	out.push({
		kind: "ellipse",
		attrs: {
			cx: round(cx),
			cy: round(cy),
			rx: round(rx),
			ry: round(ry),
			transform: `rotate(${NOTEHEAD_TILT_DEG} ${round(cx)} ${round(cy)})`,
			fill: "currentColor",
		},
		className: `notehead ${extraClass}`,
	});

	return cy;
}

/**
 * One straight stem spanning a set of notehead centers. `up` puts the stem on
 * the right and runs it above the highest head; `down` puts it on the left and
 * below the lowest head. A single-element `cys` yields an ordinary note stem.
 */
function verticalStem(
	cys: number[],
	cx: number,
	rx: number,
	ls: number,
	up: boolean,
): SVGElementSpec {
	const minCy = Math.min(...cys);
	const maxCy = Math.max(...cys);
	const sx = round(up ? cx + rx * 0.9 : cx - rx * 0.9);
	const y1 = round(up ? maxCy : minCy);
	const y2 = round(
		up ? minCy - ls * STEM_LENGTH_FACTOR : maxCy + ls * STEM_LENGTH_FACTOR,
	);
	return {
		kind: "line",
		attrs: { x1: sx, y1, x2: sx, y2, pathLength: 1 },
		className: "stem",
	};
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

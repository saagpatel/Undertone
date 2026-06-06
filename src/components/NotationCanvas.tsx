import { type CSSProperties, createElement } from "react";
import { type Chord, isHarmonized } from "../dsp/harmony";
import type { Phrase } from "../dsp/quantize";
import { notationHeight, staffGeometry } from "../notation/layout";
import { phraseToSVG } from "../notation/render";
import type { RevealRole, SVGElementSpec } from "../notation/types";
import "../styles/notation.css";

/** The on-screen staff geometry; shared so the SVG export matches the render. */
export const NOTATION_GEOM = staffGeometry({
	x: 28,
	y: 72,
	width: 520,
	lineSpacing: 13,
});
const VIEW_W = NOTATION_GEOM.x * 2 + NOTATION_GEOM.width;

// Reveal timing. The frame fades first; notes then stagger in so the last one
// begins drawing around LAST_NOTE_START_MS, landing the whole reveal near 1 s.
// DRAW_MS mirrors the animation durations in notation.css.
const FRAME_LEAD_MS = 140;
const LAST_NOTE_START_MS = 620;

function specToElement(spec: SVGElementSpec, key: number, delayMs?: number) {
	const style: CSSProperties | undefined =
		delayMs === undefined ? undefined : { animationDelay: `${delayMs}ms` };
	// The spec is a generic SVG serialization format; cast at this single boundary
	// rather than threading element-specific prop types through the renderer.
	return createElement(
		spec.kind,
		{ key, className: spec.className, style, ...spec.attrs } as Record<
			string,
			unknown
		>,
		spec.text,
	);
}

/**
 * Renders a quantized phrase as procedurally drawn, hand-scored sheet music.
 * When `animate` is on (the default), the notation inks itself in: the staff and
 * clef fade as a unit, then each note's strokes draw on, staggered in playing
 * order. The animation re-triggers naturally because the canvas remounts on each
 * new capture. `prefers-reduced-motion` short-circuits to the final state.
 */
export function NotationCanvas({
	phrase,
	chords,
	animate = true,
}: {
	phrase: Phrase;
	chords?: Chord[];
	animate?: boolean;
}) {
	const specs = phraseToSVG(phrase, NOTATION_GEOM, chords);
	// The viewBox grows to the bass staff only when there's harmony to engrave.
	const viewH = notationHeight(NOTATION_GEOM, isHarmonized(chords));
	const count = phrase.notes.length;
	const step =
		count > 1 ? (LAST_NOTE_START_MS - FRAME_LEAD_MS) / (count - 1) : 0;

	const delayFor = (reveal: RevealRole | undefined): number | undefined => {
		if (!animate) return undefined;
		if (reveal === undefined || reveal === "frame") return 0;
		return Math.round(FRAME_LEAD_MS + reveal * step);
	};

	// Chord-symbol specs render OUTSIDE the ink filter so labels stay crisp,
	// while all other notation keeps the hand-scored displacement wobble.
	const inkSpecs = specs.filter((s) => s.className !== "chord-symbol");
	const chordSpecs = specs.filter((s) => s.className === "chord-symbol");

	return (
		<svg
			className="notation"
			viewBox={`0 0 ${VIEW_W} ${viewH}`}
			preserveAspectRatio="xMidYMid meet"
			role="img"
			aria-label="Your hummed melody, rendered as sheet music"
		>
			<defs>
				<filter id="undertone-ink" x="-8%" y="-8%" width="116%" height="116%">
					<feTurbulence
						type="fractalNoise"
						baseFrequency="0.014"
						numOctaves="2"
						seed="7"
						result="noise"
					/>
					<feDisplacementMap in="SourceGraphic" in2="noise" scale="2.4" />
				</filter>
			</defs>
			{/* Staff, clef, notes — pass through the ink displacement filter */}
			<g
				className={
					animate ? "notation__ink notation__ink--animate" : "notation__ink"
				}
				filter="url(#undertone-ink)"
			>
				{inkSpecs.map((spec, i) =>
					specToElement(spec, i, delayFor(spec.reveal)),
				)}
			</g>
			{/* Chord symbols — crisp, no filter, but still participate in reveal */}
			{chordSpecs.length > 0 && (
				<g className="notation__chords">
					{chordSpecs.map((spec, i) =>
						specToElement(spec, i, delayFor(spec.reveal)),
					)}
				</g>
			)}
		</svg>
	);
}

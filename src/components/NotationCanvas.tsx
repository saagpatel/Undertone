import { type CSSProperties, createElement } from "react";
import type { Phrase } from "../dsp/quantize";
import { staffGeometry } from "../notation/layout";
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
const VIEW_H =
	NOTATION_GEOM.y * 2 +
	(NOTATION_GEOM.numLines - 1) * NOTATION_GEOM.lineSpacing;

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
	animate = true,
}: {
	phrase: Phrase;
	animate?: boolean;
}) {
	const specs = phraseToSVG(phrase, NOTATION_GEOM);
	const count = phrase.notes.length;
	const step =
		count > 1 ? (LAST_NOTE_START_MS - FRAME_LEAD_MS) / (count - 1) : 0;

	const delayFor = (reveal: RevealRole | undefined): number | undefined => {
		if (!animate) return undefined;
		if (reveal === undefined || reveal === "frame") return 0;
		return Math.round(FRAME_LEAD_MS + reveal * step);
	};

	return (
		<svg
			className="notation"
			viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
			preserveAspectRatio="xMidYMid meet"
			role="img"
			aria-label="Your hummed melody, rendered as sheet music"
		>
			<defs>
				<filter id="undertone-ink" x="-5%" y="-5%" width="110%" height="110%">
					<feTurbulence
						type="fractalNoise"
						baseFrequency="0.012"
						numOctaves="2"
						seed="7"
						result="noise"
					/>
					<feDisplacementMap in="SourceGraphic" in2="noise" scale="1.4" />
				</filter>
			</defs>
			<g
				className={
					animate ? "notation__ink notation__ink--animate" : "notation__ink"
				}
				filter="url(#undertone-ink)"
			>
				{specs.map((spec, i) => specToElement(spec, i, delayFor(spec.reveal)))}
			</g>
		</svg>
	);
}

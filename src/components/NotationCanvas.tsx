import { createElement } from "react";
import type { Phrase } from "../dsp/quantize";
import { staffGeometry } from "../notation/layout";
import { phraseToSVG } from "../notation/render";
import type { SVGElementSpec } from "../notation/types";
import "../styles/notation.css";

const GEOM = staffGeometry({ x: 28, y: 72, width: 520, lineSpacing: 13 });
const VIEW_W = GEOM.x * 2 + GEOM.width;
const VIEW_H = GEOM.y * 2 + (GEOM.numLines - 1) * GEOM.lineSpacing;

function specToElement(spec: SVGElementSpec, key: number) {
	// The spec is a generic SVG serialization format; cast at this single boundary
	// rather than threading element-specific prop types through the renderer.
	return createElement(
		spec.kind,
		{ key, className: spec.className, ...spec.attrs } as Record<
			string,
			unknown
		>,
		spec.text,
	);
}

/** Renders a quantized phrase as procedurally drawn, hand-scored sheet music. */
export function NotationCanvas({ phrase }: { phrase: Phrase }) {
	const specs = phraseToSVG(phrase, GEOM);
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
			<g className="notation__ink" filter="url(#undertone-ink)">
				{specs.map(specToElement)}
			</g>
		</svg>
	);
}

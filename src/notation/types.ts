/** Geometry of the rendered staff, in SVG user units (pixels). */
export interface StaffGeometry {
	/** Left edge of the staff lines. */
	x: number;
	/** Y-coordinate of the TOP staff line (treble: F5). */
	y: number;
	/** Staff line length. */
	width: number;
	/** Pixels between adjacent staff lines (one diatonic step = half this). */
	lineSpacing: number;
	/** Always 5 for a standard staff. */
	numLines: number;
}

export type SVGShapeKind = "line" | "ellipse" | "path" | "text";

/**
 * A framework-agnostic description of one SVG primitive. <NotationCanvas> maps
 * these to React SVG elements; Phase 3's export serializes them to raw SVG.
 */
export interface SVGElementSpec {
	kind: SVGShapeKind;
	attrs: Record<string, string | number>;
	className?: string;
	/** Text content for `kind: 'text'` (e.g. the clef glyph). */
	text?: string;
}

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
 * Reveal grouping for the Phase 3 ink animation: `"frame"` elements (staff +
 * clef) fade in as a unit, while each note's glyphs carry that note's index so
 * <NotationCanvas> can stagger them into view in playing order. Ignored by the
 * static SVG export.
 */
export type RevealRole = "frame" | number;

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
	/** Stagger group for the reveal animation; absent → not animated. */
	reveal?: RevealRole;
	/**
	 * Index of the melody note this glyph belongs to, for hit-testing in the
	 * React layer (Phase 12 editing).
	 *
	 * Deliberately separate from `reveal`, which chord glyphs also borrow to
	 * stagger with the melody note above them — a chord glyph must never
	 * hit-test as a melody note. Only melody glyphs carry this.
	 */
	noteIndex?: number;
}

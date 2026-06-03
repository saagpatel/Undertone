import type { Phrase } from "../dsp/quantize";

const ACCIDENTAL_GLYPH = { sharp: "♯", flat: "♭" } as const;

/**
 * Phase 1 placeholder view of a captured phrase, rendered as text. Phase 2
 * replaces this with the procedural <NotationCanvas> SVG renderer.
 */
export function PhrasePreview({ phrase }: { phrase: Phrase }) {
	if (phrase.notes.length === 0) {
		return (
			<p className="phrase-preview phrase-preview--empty">
				No notes caught — try humming a little louder.
			</p>
		);
	}

	return (
		<ol className="phrase-preview">
			{phrase.notes.map((note, i) => (
				<li key={`${note.beatPosition}-${i}`} className="phrase-preview__note">
					<span className="phrase-preview__pitch">
						{note.pitch}
						{note.accidental ? ACCIDENTAL_GLYPH[note.accidental] : ""}
						{note.octave}
					</span>
					<span className="phrase-preview__value">{note.noteValue}</span>
				</li>
			))}
		</ol>
	);
}

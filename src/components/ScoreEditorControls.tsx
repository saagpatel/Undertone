import type { ScoreEditor } from "../hooks/useScoreEditor";

interface ScoreEditorControlsProps {
	editor: ScoreEditor;
	/** Number of melody notes, so the controls disable on an empty score. */
	noteCount: number;
	onTranspose: (steps: number) => void;
	onChangeValue: (direction: 1 | -1) => void;
	onDelete: () => void;
	onDuplicate: () => void;
	onNudge: (beats: number) => void;
}

/**
 * Editing toolbar.
 *
 * Every gesture the keyboard shortcuts offer is also a real button, so pointer
 * and screen-reader users get the same editing power rather than a lesser
 * version of it. Buttons disable when there is nothing selected to act on,
 * which is what tells an assistive technology that selection comes first.
 */
export function ScoreEditorControls({
	editor,
	noteCount,
	onTranspose,
	onChangeValue,
	onDelete,
	onDuplicate,
	onNudge,
}: ScoreEditorControlsProps) {
	const hasSelection = editor.selectedIndex !== null;
	const empty = noteCount === 0;

	return (
		<div className="editor" role="toolbar" aria-label="Edit the score">
			<div className="editor__group">
				<button
					type="button"
					className="ghost-button"
					aria-label="Select the previous note"
					disabled={empty}
					onClick={() => editor.moveSelection(-1)}
				>
					‹ Note
				</button>
				<button
					type="button"
					className="ghost-button"
					aria-label="Select the next note"
					disabled={empty}
					onClick={() => editor.moveSelection(1)}
				>
					Note ›
				</button>
			</div>

			<div className="editor__group">
				<button
					type="button"
					className="ghost-button"
					aria-label="Move the selected note up one step"
					disabled={!hasSelection}
					onClick={() => onTranspose(1)}
				>
					Up
				</button>
				<button
					type="button"
					className="ghost-button"
					aria-label="Move the selected note down one step"
					disabled={!hasSelection}
					onClick={() => onTranspose(-1)}
				>
					Down
				</button>
			</div>

			<div className="editor__group">
				<button
					type="button"
					className="ghost-button"
					aria-label="Make the selected note longer"
					disabled={!hasSelection}
					onClick={() => onChangeValue(-1)}
				>
					Longer
				</button>
				<button
					type="button"
					className="ghost-button"
					aria-label="Make the selected note shorter"
					disabled={!hasSelection}
					onClick={() => onChangeValue(1)}
				>
					Shorter
				</button>
			</div>

			<div className="editor__group">
				<button
					type="button"
					className="ghost-button"
					aria-label="Move the selected note earlier by one beat"
					disabled={!hasSelection}
					onClick={() => onNudge(-1)}
				>
					Earlier
				</button>
				<button
					type="button"
					className="ghost-button"
					aria-label="Move the selected note later by one beat"
					disabled={!hasSelection}
					onClick={() => onNudge(1)}
				>
					Later
				</button>
			</div>

			<div className="editor__group">
				<button
					type="button"
					className="ghost-button"
					aria-label="Add a copy of the selected note after it"
					disabled={!hasSelection}
					onClick={onDuplicate}
				>
					Add note
				</button>
				<button
					type="button"
					className="ghost-button"
					aria-label="Delete the selected note"
					disabled={!hasSelection}
					onClick={onDelete}
				>
					Delete note
				</button>
			</div>

			<div className="editor__group">
				<button
					type="button"
					className="ghost-button"
					aria-label="Undo the last edit"
					disabled={!editor.canUndo}
					onClick={editor.undo}
				>
					Undo
				</button>
				<button
					type="button"
					className="ghost-button"
					aria-label="Redo the last undone edit"
					disabled={!editor.canRedo}
					onClick={editor.redo}
				>
					Redo
				</button>
			</div>
		</div>
	);
}

import { useCallback, useEffect, useMemo, useState } from "react";
import { CaptureButton } from "./components/CaptureButton";
import { InputSourcePicker } from "./components/InputSourcePicker";
import type { InputSource } from "./components/InputSourcePicker";
import { LibraryPanel } from "./components/LibraryPanel";
import { NOTATION_GEOM, NotationCanvas } from "./components/NotationCanvas";
import { PitchMeter } from "./components/PitchMeter";
import type { AccompanimentStyle } from "./dsp/accompaniment";
import { harmonize } from "./dsp/harmony";
import { useActiveComposition } from "./hooks/useActiveComposition";
import { useCapture } from "./hooks/useCapture";
import { useCompositionLibrary } from "./hooks/useCompositionLibrary";
import { useLatestCapture } from "./hooks/useLatestCapture";
import { useMidiCapture } from "./hooks/useMidiCapture";
import { usePlayback } from "./hooks/usePlayback";
import { useScoreEditor } from "./hooks/useScoreEditor";
import { ScoreEditorControls } from "./components/ScoreEditorControls";
import {
	deleteNote,
	duplicateNoteAfter,
	moveNoteInTime,
	stepNoteValue,
	transposeNote,
} from "./dsp/edit";
import { serializePhraseSVG } from "./notation/serialize";
import { DEFAULT_COMPOSITION_NAME } from "./storage/config";
import { exportComposition, importComposition } from "./storage/file";
import { buildShareLink, restoreFromHash } from "./storage/share";
import { CodecError } from "./storage/types";

/** Trigger a browser download for generated text content. */
function downloadText(filename: string, contents: string, mimeType: string) {
	const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}

/** Accompaniment textures, in selector order. Block is the default (v2 parity). */
const STYLE_OPTIONS: ReadonlyArray<{
	value: AccompanimentStyle;
	label: string;
}> = [
	{ value: "block", label: "Block" },
	{ value: "arpeggio", label: "Arpeggio" },
	{ value: "alberti", label: "Alberti" },
];

export default function App() {
	const mic = useCapture();
	const midi = useMidiCapture();
	const [inputSource, setInputSource] = useState<InputSource>("mic");

	// Whichever modality performed most recently owns the score on screen, so
	// switching inputs to reach the device picker never blanks a finished take.
	const latest = useLatestCapture([mic, midi]);
	const active = useActiveComposition(latest.phrase, latest.captureId);
	// Editing layers on top of the active composition and never writes back, so
	// the data flow stays one-way and the renderer stays pure.
	const editor = useScoreEditor(active.composition);
	const library = useCompositionLibrary();
	const [notice, setNotice] = useState<string | null>(null);
	const [shareError, setShareError] = useState<string | null>(null);

	// The armed input owns the transport and the live meter.
	const armed = inputSource === "midi" ? midi : mic;
	const isCapturing = armed.isCapturing;
	const pitch = armed.pitch;
	// Only microphone errors surface here. MIDI failures are reported by
	// InputSourcePicker, right beside the device controls that caused them —
	// showing them in both places says the same thing twice.
	const error = mic.error;

	const start = useCallback(() => {
		if (inputSource === "midi") {
			midi.start();
			return;
		}
		void mic.start();
	}, [inputSource, midi.start, mic.start]);

	const stop = useCallback(() => {
		if (inputSource === "midi") {
			midi.stop();
			return;
		}
		mic.stop();
	}, [inputSource, midi.stop, mic.stop]);

	// Ask for MIDI access the moment the user arms that input, so the device
	// picker is populated before they reach for the keyboard.
	const { isSupported: midiSupported, connect: connectMidi } = midi;
	useEffect(() => {
		if (inputSource === "midi" && midiSupported) void connectMidi();
	}, [inputSource, midiSupported, connectMidi]);

	// The edited score is what everything downstream sees: playback, engraving,
	// SVG export, saving, and sharing all read the same composition.
	const composition = editor.composition;
	const hasNotes = !!composition && composition.phrase.notes.length > 0;

	// Derive the harmonization from whichever score is on screen. The key rides
	// with a loaded composition and is re-derived after each edit, so a restored
	// score harmonizes as it was saved and an edited one tracks the change.
	//
	// Not debounced, contrary to the plan: `harmonize` is a pure synchronous pass
	// over the melody, so re-running it per keystroke costs microseconds. A
	// debounce would add visible lag to every edit to save nothing measurable.
	const chords = useMemo(
		() =>
			composition && composition.key && composition.phrase.notes.length > 0
				? harmonize(composition.phrase, composition.key)
				: [],
		[composition],
	);
	const [style, setStyle] = useState<AccompanimentStyle>("block");
	const playback = usePlayback(composition?.phrase ?? null, chords, style);
	const status = isCapturing ? "recording" : composition ? "done" : "idle";

	const { load } = active;

	// --- Editing -----------------------------------------------------------
	// Every gesture is a pure Phrase -> Phrase function handed to the editor,
	// which records history and re-derives the key. Nothing here mutates.

	// Edits receive the selection and key when they run, not when they were
	// built. Two arrow keys pressed quickly land in one React batch, and a
	// handler holding a render-time selection would act on a stale one.
	const { apply: applyEdit } = editor;

	const handleTranspose = useCallback(
		(steps: number) => {
			applyEdit((phrase, index, key) =>
				index === null || key === null
					? phrase
					: transposeNote(phrase, index, steps, key),
			);
		},
		[applyEdit],
	);

	const handleChangeValue = useCallback(
		(direction: 1 | -1) => {
			applyEdit((phrase, index) =>
				index === null ? phrase : stepNoteValue(phrase, index, direction),
			);
		},
		[applyEdit],
	);

	const handleNudge = useCallback(
		(beats: number) => {
			applyEdit((phrase, index) => {
				if (index === null) return phrase;
				// Moving re-sorts the melody, so the selection has to follow the note
				// rather than stay on a position that now holds a different one.
				const { phrase: next, index: moved } = moveNoteInTime(
					phrase,
					index,
					beats,
				);
				return { phrase: next, selectIndex: moved };
			});
		},
		[applyEdit],
	);

	const handleDeleteNote = useCallback(() => {
		applyEdit((phrase, index) =>
			index === null ? phrase : deleteNote(phrase, index),
		);
	}, [applyEdit]);

	const handleDuplicateNote = useCallback(() => {
		applyEdit((phrase, index) => {
			if (index === null) return phrase;
			const { phrase: next, index: inserted } = duplicateNoteAfter(phrase, index);
			return { phrase: next, selectIndex: inserted };
		});
	}, [applyEdit]);

	/**
	 * Keyboard editing. Bound to the focusable score region so the shortcuts
	 * never fight the library's text inputs, and so keyboard-only editing is a
	 * first-class path rather than a shadow of the toolbar.
	 */
	const handleScoreKeyDown = useCallback(
		(event: React.KeyboardEvent) => {
			if (!hasNotes) return;
			const accel = event.metaKey || event.ctrlKey;

			if (accel && event.key.toLowerCase() === "z") {
				event.preventDefault();
				if (event.shiftKey) editor.redo();
				else editor.undo();
				return;
			}
			if (accel) return;

			switch (event.key) {
				case "ArrowRight":
					event.preventDefault();
					if (event.shiftKey) handleNudge(1);
					else editor.moveSelection(1);
					return;
				case "ArrowLeft":
					event.preventDefault();
					if (event.shiftKey) handleNudge(-1);
					else editor.moveSelection(-1);
					return;
				case "ArrowUp":
					event.preventDefault();
					handleTranspose(event.shiftKey ? 7 : 1);
					return;
				case "ArrowDown":
					event.preventDefault();
					handleTranspose(event.shiftKey ? -7 : -1);
					return;
				case "[":
					event.preventDefault();
					handleChangeValue(-1);
					return;
				case "]":
					event.preventDefault();
					handleChangeValue(1);
					return;
				case "Enter":
					event.preventDefault();
					handleDuplicateNote();
					return;
				case "Delete":
				case "Backspace":
					event.preventDefault();
					handleDeleteNote();
					return;
				case "Escape":
					event.preventDefault();
					editor.select(null);
					return;
				default:
			}
		},
		[
			hasNotes,
			editor.undo,
			editor.redo,
			editor.moveSelection,
			editor.select,
			handleNudge,
			handleTranspose,
			handleChangeValue,
			handleDuplicateNote,
			handleDeleteNote,
		],
	);

	// Share links: restore the score before the microphone is ever touched, so a
	// shared composition opens on a device with no mic at all.
	//
	// This listens for `hashchange` as well as running on mount. Pasting a share
	// link into an address bar that already has Undertone open is a same-document
	// navigation — the app never remounts — so a mount-only effect would leave
	// the previous score on screen and look broken.
	useEffect(() => {
		const applyHash = () => {
			try {
				const shared = restoreFromHash(window.location.hash);
				if (!shared) return;
				load(shared);
				setShareError(null);
				setNotice("Opened a shared score. Save it to keep it.");
			} catch (problem) {
				console.error(
					"Undertone: could not read the score in this link.",
					problem,
				);
				setNotice(null);
				setShareError(
					problem instanceof CodecError
						? "This share link is damaged — the score in it could not be read."
						: "This share link could not be opened.",
				);
			}
		};

		applyHash();
		window.addEventListener("hashchange", applyHash);
		return () => window.removeEventListener("hashchange", applyHash);
	}, [load]);

	const handleExportSVG = () => {
		if (!composition || !hasNotes) return;
		const svg = serializePhraseSVG(
			composition.phrase,
			NOTATION_GEOM,
			chords,
			style,
		);
		downloadText("undertone.svg", svg, "image/svg+xml");
	};

	const handleExportFile = () => {
		if (!composition || !hasNotes) return;
		try {
			const file = exportComposition(
				DEFAULT_COMPOSITION_NAME,
				composition,
				Date.now(),
			);
			downloadText(file.filename, file.contents, file.mimeType);
			setNotice(`Exported ${file.filename}.`);
		} catch (problem) {
			console.error("Undertone: could not export this composition.", problem);
			setShareError("This composition could not be exported.");
		}
	};

	const handleImportFile = useCallback(
		async (file: File) => {
			try {
				const { name, composition: imported } = importComposition(
					await file.text(),
				);
				load(imported);
				setShareError(null);
				setNotice(`Opened "${name}" from a file.`);
			} catch (problem) {
				console.error("Undertone: could not import this file.", problem);
				setShareError(
					problem instanceof CodecError
						? problem.message
						: "This file could not be imported.",
				);
			}
		},
		[load],
	);

	const handleCopyShareLink = async () => {
		if (!composition || !hasNotes) return;
		try {
			const link = buildShareLink(composition, window.location.href);
			if (!link.withinLengthLimit) {
				setShareError(
					"This score is too long for a share link. Export it as a file instead.",
				);
				return;
			}
			await navigator.clipboard.writeText(link.url);
			setShareError(null);
			setNotice("Share link copied. Anyone who opens it sees this score.");
		} catch (problem) {
			console.error("Undertone: could not copy the share link.", problem);
			setShareError("Could not copy the share link to your clipboard.");
		}
	};

	const handleOpenSaved = async (id: string) => {
		const record = await library.load(id);
		if (!record) return;
		load(record.composition);
		setShareError(null);
		setNotice(`Opened "${record.name}".`);
	};

	const handleSave = (name: string) => {
		if (!composition || !hasNotes) return;
		// library.save never rejects — it reports failure through library.error —
		// so the success message is gated on the returned flag. Announcing "Saved"
		// after a failed save is the exact outcome this feature exists to prevent.
		void library.save(name, composition).then((saved) => {
			if (saved) setNotice(`Saved "${name}".`);
		});
	};

	return (
		<main className="app">
			<header className="app__header">
				<h1 className="app__title">Undertone</h1>
				<p className="app__tagline">Hum a melody — watch it reveal itself.</p>
			</header>

			{/* Focusable so the whole score is keyboard-editable. The shortcuts live
			    here rather than on the document so they never fight the library's
			    text inputs. The hint is only referenced when it is actually
			    rendered — a dangling aria-describedby is a broken promise to a
			    screen reader. */}
			<section
				className="app__stage"
				tabIndex={hasNotes && !isCapturing ? 0 : -1}
				role="group"
				aria-label="Your score. Use the arrow keys to select and edit notes."
				aria-describedby={
					hasNotes && !isCapturing ? "editor-hint" : undefined
				}
				onKeyDown={isCapturing ? undefined : handleScoreKeyDown}
			>
				{isCapturing ? (
					<PitchMeter pitch={pitch} />
				) : composition ? (
					hasNotes ? (
						<NotationCanvas
							phrase={composition.phrase}
							chords={chords}
							style={style}
							selectedIndex={editor.selectedIndex}
							onSelectNote={editor.select}
						/>
					) : (
						<p className="app__empty">
							No notes caught — try humming a little louder.
						</p>
					)
				) : (
					<PitchMeter pitch={null} />
				)}
			</section>

			{hasNotes && !isCapturing && (
				<>
					<ScoreEditorControls
						editor={editor}
						noteCount={composition?.phrase.notes.length ?? 0}
						onTranspose={handleTranspose}
						onChangeValue={handleChangeValue}
						onDelete={handleDeleteNote}
						onDuplicate={handleDuplicateNote}
						onNudge={handleNudge}
					/>
					<p className="app__hint app__hint--editor" id="editor-hint">
						Click a note, or focus the score and use ← → to select, ↑ ↓ to move
						it by a step, [ ] for its length, Enter to add, Delete to remove.
					</p>
				</>
			)}

			<div className="app__controls">
				<InputSourcePicker
					source={inputSource}
					onSelect={setInputSource}
					midi={midi}
					disabled={isCapturing}
				/>

				<CaptureButton status={status} onStart={start} onStop={stop} />

				{hasNotes && (
					<div
						className="style-selector"
						role="group"
						aria-label="Accompaniment style"
					>
						{STYLE_OPTIONS.map((opt) => (
							<button
								key={opt.value}
								type="button"
								aria-pressed={style === opt.value}
								className={
									style === opt.value
										? "style-selector__option is-selected"
										: "style-selector__option"
								}
								onClick={() => setStyle(opt.value)}
							>
								{opt.label}
							</button>
						))}
					</div>
				)}

				{hasNotes && (
					<div className="score-actions">
						<button
							type="button"
							className="ghost-button"
							onClick={playback.isPlaying ? playback.stop : playback.play}
						>
							{playback.isPlaying ? "Stop" : "Play"}
						</button>
						<button
							type="button"
							className="ghost-button"
							onClick={handleExportSVG}
						>
							Export SVG
						</button>
						<button
							type="button"
							className="ghost-button"
							onClick={handleCopyShareLink}
						>
							Copy share link
						</button>
					</div>
				)}

				{error ? (
					<p className="app__error" role="alert">
						{error}
					</p>
				) : shareError ? (
					<p className="app__error" role="alert">
						{shareError}
					</p>
				) : notice ? (
					<p className="app__hint" role="status">
						{notice}
					</p>
				) : (
					<p className="app__hint">hum → reveal → save → share</p>
				)}
			</div>

			<LibraryPanel
				records={library.records}
				kind={library.kind}
				error={library.error}
				canSave={hasNotes}
				onSave={handleSave}
				onOpen={handleOpenSaved}
				onRename={(id, name) => void library.rename(id, name)}
				onDelete={(id) => void library.remove(id)}
				onExport={handleExportFile}
				onImport={(file) => void handleImportFile(file)}
			/>
		</main>
	);
}

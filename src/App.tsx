import { useCallback, useEffect, useMemo, useState } from "react";
import { CaptureButton } from "./components/CaptureButton";
import { LibraryPanel } from "./components/LibraryPanel";
import { NOTATION_GEOM, NotationCanvas } from "./components/NotationCanvas";
import { PitchMeter } from "./components/PitchMeter";
import { harmonize } from "./dsp/harmony";
import { useActiveComposition } from "./hooks/useActiveComposition";
import { useCapture } from "./hooks/useCapture";
import { useCompositionLibrary } from "./hooks/useCompositionLibrary";
import { usePlayback } from "./hooks/usePlayback";
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

export default function App() {
	const { pitch, phrase, captureId, isCapturing, error, start, stop } =
		useCapture();
	const active = useActiveComposition(phrase, captureId);
	const library = useCompositionLibrary();
	const [notice, setNotice] = useState<string | null>(null);
	const [shareError, setShareError] = useState<string | null>(null);

	const composition = active.composition;
	const hasNotes = !!composition && composition.phrase.notes.length > 0;

	// Derive the harmonization from whichever score is on screen. The key rides
	// with a loaded composition, so a restored score harmonizes exactly as it
	// did when it was saved.
	const chords = useMemo(
		() =>
			composition && composition.key && composition.phrase.notes.length > 0
				? harmonize(composition.phrase, composition.key)
				: [],
		[composition],
	);

	const playback = usePlayback(composition?.phrase ?? null, chords);
	const status = isCapturing ? "recording" : composition ? "done" : "idle";

	const { load } = active;

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
		const svg = serializePhraseSVG(composition.phrase, NOTATION_GEOM, chords);
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
		void library.save(name, composition).then(() => setNotice(`Saved "${name}".`));
	};

	return (
		<main className="app">
			<header className="app__header">
				<h1 className="app__title">Undertone</h1>
				<p className="app__tagline">Hum a melody — watch it reveal itself.</p>
			</header>

			<section className="app__stage">
				{isCapturing ? (
					<PitchMeter pitch={pitch} />
				) : composition ? (
					hasNotes ? (
						<NotationCanvas phrase={composition.phrase} chords={chords} />
					) : (
						<p className="app__empty">
							No notes caught — try humming a little louder.
						</p>
					)
				) : (
					<PitchMeter pitch={null} />
				)}
			</section>

			<div className="app__controls">
				<CaptureButton status={status} onStart={start} onStop={stop} />

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

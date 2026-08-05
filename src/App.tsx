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
	const [style, setStyle] = useState<AccompanimentStyle>("block");
	const playback = usePlayback(composition?.phrase ?? null, chords, style);
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

			<section className="app__stage">
				{isCapturing ? (
					<PitchMeter pitch={pitch} />
				) : composition ? (
					hasNotes ? (
						<NotationCanvas
							phrase={composition.phrase}
							chords={chords}
							style={style}
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

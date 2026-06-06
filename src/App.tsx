import { useEffect, useMemo } from "react";
import { CaptureButton } from "./components/CaptureButton";
import { NOTATION_GEOM, NotationCanvas } from "./components/NotationCanvas";
import { PitchMeter } from "./components/PitchMeter";
import { harmonize } from "./dsp/harmony";
import { detectKey } from "./dsp/key";
import { useCapture } from "./hooks/useCapture";
import { usePlayback } from "./hooks/usePlayback";
import { serializePhraseSVG } from "./notation/serialize";

/** localStorage key for the most recent captured phrase (local-only, optional). */
const STORAGE_KEY = "undertone.lastPhrase";

export default function App() {
	const { pitch, phrase, isCapturing, error, start, stop } = useCapture();
	// Derive the harmonization once per capture: detect the key, then harmonize.
	// Pure derivations of the immutable phrase — the melody is never mutated.
	const chords = useMemo(
		() =>
			phrase && phrase.notes.length > 0
				? harmonize(phrase, detectKey(phrase))
				: [],
		[phrase],
	);
	const playback = usePlayback(phrase, chords);
	const status = isCapturing ? "recording" : phrase ? "done" : "idle";
	const hasNotes = !!phrase && phrase.notes.length > 0;

	// Persist the last phrase locally — best-effort, never blocks the UI and
	// never leaves the tab. localStorage can throw (private mode, quota): log it.
	useEffect(() => {
		if (!phrase) return;
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify(phrase));
		} catch (err) {
			console.warn("Undertone: could not save the last phrase locally.", err);
		}
	}, [phrase]);

	const handleExport = () => {
		if (!hasNotes || !phrase) return;
		const svg = serializePhraseSVG(phrase, NOTATION_GEOM, chords);
		const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
		const link = document.createElement("a");
		link.href = url;
		link.download = "undertone.svg";
		document.body.appendChild(link);
		link.click();
		link.remove();
		URL.revokeObjectURL(url);
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
				) : phrase ? (
					hasNotes ? (
						<NotationCanvas phrase={phrase} chords={chords} />
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
							onClick={handleExport}
						>
							Export SVG
						</button>
					</div>
				)}

				{error ? (
					<p className="app__error" role="alert">
						{error}
					</p>
				) : (
					<p className="app__hint">hum → reveal → play → export</p>
				)}
			</div>
		</main>
	);
}

import { CaptureButton } from "./components/CaptureButton";
import { PhrasePreview } from "./components/PhrasePreview";
import { PitchMeter } from "./components/PitchMeter";
import { useCapture } from "./hooks/useCapture";

export default function App() {
	const { pitch, phrase, isCapturing, error, start, stop } = useCapture();
	const status = isCapturing ? "recording" : phrase ? "done" : "idle";

	return (
		<main className="app">
			<header className="app__header">
				<h1 className="app__title">Undertone</h1>
				<p className="app__tagline">Hum a melody — watch it reveal itself.</p>
			</header>

			<section className="app__stage">
				{isCapturing || !phrase ? (
					<PitchMeter pitch={isCapturing ? pitch : null} />
				) : (
					<PhrasePreview phrase={phrase} />
				)}
			</section>

			<div className="app__controls">
				<CaptureButton status={status} onStart={start} onStop={stop} />
				{error ? (
					<p className="app__error" role="alert">
						{error}
					</p>
				) : (
					<p className="app__hint">Phase 1 · capture + quantize</p>
				)}
			</div>
		</main>
	);
}

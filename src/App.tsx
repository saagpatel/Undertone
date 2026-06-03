import { PitchMeter } from "./components/PitchMeter";
import { useAudioCapture } from "./hooks/useAudioCapture";
import { useCapture } from "./hooks/useCapture";

export default function App() {
	const audio = useAudioCapture();
	const pitch = useCapture(audio.analyser, audio.sampleRate);
	const listening = audio.state === "running";

	return (
		<main className="app">
			<header className="app__header">
				<h1 className="app__title">Undertone</h1>
				<p className="app__tagline">
					Hum a melody — watch its pitch reveal itself.
				</p>
			</header>

			<section className="app__stage">
				<PitchMeter pitch={listening ? pitch : null} />
			</section>

			<div className="app__controls">
				<button
					type="button"
					className="mic-button"
					data-listening={listening}
					onClick={listening ? audio.stop : audio.start}
				>
					{listening ? "Stop listening" : "Start listening"}
				</button>
				{audio.error ? (
					<p className="app__error" role="alert">
						{audio.error}
					</p>
				) : (
					<p className="app__hint">Phase 0 · live pitch detection</p>
				)}
			</div>
		</main>
	);
}

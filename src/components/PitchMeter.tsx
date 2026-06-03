import { CONFIDENCE_GATE, type PitchResult } from "../dsp/pitch";

const NOTE_NAMES = [
	"C",
	"C♯",
	"D",
	"D♯",
	"E",
	"F",
	"F♯",
	"G",
	"G♯",
	"A",
	"A♯",
	"B",
];

/**
 * Phase 0 display helper: nearest-semitone label (e.g. "A4"). The authoritative
 * chromatic mapping (accidentals, octaves, enharmonics) arrives with quantize.ts
 * in Phase 1 — this is just enough to read the meter.
 */
function noteLabel(frequency: number): string {
	const midi = Math.round(69 + 12 * Math.log2(frequency / 440));
	const name = NOTE_NAMES[((midi % 12) + 12) % 12];
	const octave = Math.floor(midi / 12) - 1;
	return `${name}${octave}`;
}

/** Live frequency readout. Shows a dash until a confident pitch is detected. */
export function PitchMeter({ pitch }: { pitch: PitchResult | null }) {
	const confident =
		pitch !== null &&
		pitch.frequency > 0 &&
		pitch.confidence >= CONFIDENCE_GATE;

	return (
		<div className="pitch-meter">
			<div
				className="pitch-meter__note"
				aria-label={
					confident
						? `Detected ${noteLabel(pitch.frequency)}`
						: "No pitch detected"
				}
			>
				{confident ? noteLabel(pitch.frequency) : "–"}
			</div>
			<div className="pitch-meter__hz">
				{confident ? `${pitch.frequency.toFixed(1)} Hz` : "listening…"}
			</div>
			<div className="pitch-meter__confidence">
				<span
					className="pitch-meter__confidence-fill"
					style={{ width: `${Math.round((pitch?.confidence ?? 0) * 100)}%` }}
				/>
			</div>
		</div>
	);
}

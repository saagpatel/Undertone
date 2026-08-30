import type {
	ComparisonIssue,
	MelodyTake,
	TakeComparison,
} from "../dsp/rehearsal";

interface RehearsalPanelProps {
	currentTake: MelodyTake | null;
	baseline: MelodyTake | null;
	repeat: MelodyTake | null;
	comparison: TakeComparison | null;
	targetPlaying: boolean;
	targetProgress: number | null;
	onStart: () => void;
	onReset: () => void;
	onPlayTarget: () => void;
	onStopTarget: () => void;
}

const ISSUE_COPY: Record<ComparisonIssue, string> = {
	"insufficient-audio": "Not enough voiced audio for a comparison.",
	"different-note-count":
		"The takes produced different note counts. Undertone used a bounded time-and-contour alignment when enough notes matched and lowered confidence.",
	"low-confidence": "Some pitched frames were below the confidence gate.",
	"background-noise":
		"Energetic frames without a stable pitch suggest background noise.",
	clipping: "Some samples reached the clipping threshold.",
	"unvoiced-sections": "The take includes unvoiced or silent sections.",
	"out-of-range":
		"Some energetic frames produced an explicit pitch observation outside Undertone's analysis range.",
	"timing-uncertain":
		"The inferred pulse is uncertain from this amount of audio.",
	"possible-octave-shift":
		"The whole contour may be an octave away; this is a possible octave choice, not detector certainty.",
	"octave-mismatch":
		"At least one local pitch differs by about an octave; check that region by ear.",
};

function signed(value: number, digits = 0): string {
	const rounded = value.toFixed(digits);
	return value > 0 ? `+${rounded}` : rounded;
}

function qualityLabel(take: MelodyTake): string {
	const quality = take.evidence.quality;
	if (quality.issues.includes("insufficient-audio")) return "insufficient";
	if (
		quality.noiseFrames > 0 ||
		quality.lowConfidenceFrames > 0 ||
		quality.clippedFrames > 0 ||
		quality.outOfRangeFrames > 0 ||
		quality.issues.includes("mostly-unvoiced")
	)
		return "limited";
	return "clear";
}

function TakeQuality({ label, take }: { label: string; take: MelodyTake }) {
	const quality = take.evidence.quality;
	const active =
		quality.voicedFrames +
		quality.noiseFrames +
		quality.lowConfidenceFrames +
		quality.outOfRangeFrames;
	const voicedPercent =
		active === 0 ? 0 : Math.round((quality.voicedFrames / active) * 100);
	const totalFrames = active + quality.unvoicedFrames;
	const unvoicedPercent =
		totalFrames === 0
			? 0
			: Math.round((quality.unvoicedFrames / totalFrames) * 100);
	const limits = [
		quality.lowConfidenceFrames > 0
			? `${quality.lowConfidenceFrames} low-confidence pitched frames`
			: null,
		quality.noiseFrames > 0 ? `${quality.noiseFrames} noisy frames` : null,
		quality.clippedFrames > 0
			? `${quality.clippedFrames} clipped frames`
			: null,
		quality.outOfRangeFrames > 0
			? `${quality.outOfRangeFrames} out-of-range frames`
			: null,
	].filter((limit): limit is string => limit !== null);
	return (
		<div className="rehearsal-quality">
			<strong>{label}</strong>
			<span className={`confidence-tag confidence-tag--${qualityLabel(take)}`}>
				{qualityLabel(take)} evidence
			</span>
			<span>{take.evidence.rawPhrase.length} notes</span>
			<span>{voicedPercent}% of active frames voiced</span>
			<span>{unvoicedPercent}% of timeline unvoiced</span>
			{limits.length > 0 && <span>{limits.join(" · ")}</span>}
			<span>analysis {take.processingLatencyMs.toFixed(1)} ms</span>
		</div>
	);
}

interface ContourBounds {
	lowMidi: number;
	highMidi: number;
	durationMs: number;
}

function takeDuration(take: MelodyTake): number {
	const notes = take.evidence.rawPhrase;
	if (notes.length === 0) return 1;
	const first = notes[0].onsetMs;
	return Math.max(
		1,
		...notes.map((note) => note.onsetMs + note.durationMs - first),
	);
}

function contourBounds(
	baseline: MelodyTake,
	repeat: MelodyTake | null,
): ContourBounds {
	const takes = repeat ? [baseline, repeat] : [baseline];
	const midi = takes.flatMap((take) =>
		take.evidence.rawPhrase.map(
			(note) => 69 + 12 * Math.log2(note.frequency / 440),
		),
	);
	return {
		lowMidi: Math.min(...midi) - 1,
		highMidi: Math.max(...midi) + 1,
		durationMs: Math.max(...takes.map(takeDuration)),
	};
}

function contourPoints(take: MelodyTake, bounds: ContourBounds): string {
	const notes = take.evidence.rawPhrase;
	if (notes.length === 0) return "";
	const first = notes[0].onsetMs;
	const midi = notes.map((note) => 69 + 12 * Math.log2(note.frequency / 440));
	return notes
		.map((note, index) => {
			const x = 12 + ((note.onsetMs - first) / bounds.durationMs) * 276;
			const y =
				76 -
				((midi[index] - bounds.lowMidi) /
					Math.max(1, bounds.highMidi - bounds.lowMidi)) *
					60;
			return `${x.toFixed(1)},${y.toFixed(1)}`;
		})
		.join(" ");
}

function Contour({
	baseline,
	repeat,
	progress,
}: {
	baseline: MelodyTake;
	repeat: MelodyTake | null;
	progress: number | null;
}) {
	const repeatLimited = repeat ? qualityLabel(repeat) !== "clear" : false;
	const bounds = contourBounds(baseline, repeat);
	return (
		<div className="rehearsal-contour">
			<svg
				viewBox="0 0 300 92"
				role="img"
				aria-label={
					repeat
						? "Target pitch contour in dark ink and repeat contour in accent ink"
						: "Target pitch contour from the baseline take"
				}
			>
				<line x1="12" y1="82" x2="288" y2="82" className="contour-axis" />
				<polyline
					points={contourPoints(baseline, bounds)}
					className="contour-line contour-line--target"
				/>
				{repeat && (
					<polyline
						points={contourPoints(repeat, bounds)}
						className={
							repeatLimited
								? "contour-line contour-line--repeat is-limited"
								: "contour-line contour-line--repeat"
						}
					/>
				)}
				{progress !== null && (
					<line
						x1={12 + Math.max(0, Math.min(1, progress)) * 276}
						x2={12 + Math.max(0, Math.min(1, progress)) * 276}
						y1="8"
						y2="82"
						className="contour-playhead"
					/>
				)}
			</svg>
			<div className="rehearsal-legend" aria-hidden="true">
				<span>
					<i className="legend-target" /> target
				</span>
				{repeat && (
					<span>
						<i className="legend-repeat" /> repeat
					</span>
				)}
			</div>
		</div>
	);
}

function feedback(comparison: TakeComparison): string[] {
	if (comparison.status === "blocked") {
		return [
			"Undertone could not form three reliable ordered matches. Try another take with clearer note changes and a similar phrase shape.",
		];
	}
	if (comparison.issues.includes("different-note-count")) {
		return [
			"The bounded alignment is a hypothesis because one note was missed or split. Use the matched and unmatched counts to inspect the contour; record another take before drawing a consistency conclusion.",
		];
	}
	const messages: string[] = [];
	const pitch = comparison.pitch;
	if (pitch) {
		if (
			pitch.globalTranspositionSemitones !== null &&
			pitch.globalTranspositionSemitones !== 0
		) {
			messages.push(
				`The repeat kept an overall ${signed(pitch.globalTranspositionSemitones)}-semitone shift. If absolute pitch matters for this rehearsal, use the target's opening tone before the next take.`,
			);
		}
		if (pitch.meanAbsoluteLocalErrorCents >= 35) {
			messages.push(
				"Most remaining pitch variation is local rather than one global shift. Replay the target and trace the largest bends one region at a time.",
			);
		} else {
			messages.push(
				"After removing the overall shift, the contour stayed comparatively consistent.",
			);
		}
	}
	const timing = comparison.timing;
	if (timing && Math.abs(timing.tempoRatio - 1) >= 0.08) {
		messages.push(
			`The inferred repeat pace was ${Math.round(Math.abs(timing.tempoRatio - 1) * 100)}% ${timing.tempoRatio > 1 ? "faster" : "slower"}. Try the target again and listen for the spacing between note starts.`,
		);
	}
	if (comparison.issues.includes("low-confidence")) {
		messages.push(
			"Because some pitch evidence was weak, treat the numbers as a region to recheck rather than a verdict.",
		);
	}
	return messages;
}

function ComparisonDetails({ comparison }: { comparison: TakeComparison }) {
	const pitch = comparison.pitch;
	const timing = comparison.timing;
	return (
		<div className="rehearsal-results" aria-live="polite">
			<h3>Take-to-take comparison</h3>
			<p className="comparison-confidence">
				<strong>{comparison.status}</strong> ·{" "}
				{Math.round(comparison.alignmentConfidence * 100)}% alignment confidence
				· {comparison.matchedNotes} matched notes
				{comparison.unmatchedBaselineNotes + comparison.unmatchedRepeatNotes > 0
					? ` · ${comparison.unmatchedBaselineNotes} target and ${comparison.unmatchedRepeatNotes} repeat notes unmatched`
					: ""}
			</p>
			{pitch && (
				<dl className="comparison-metrics">
					<div>
						<dt>Overall pitch shift</dt>
						<dd>
							{pitch.globalTranspositionSemitones === null
								? `${signed(pitch.globalShiftCents)} cents (not a clear semitone)`
								: `${signed(pitch.globalTranspositionSemitones)} semitones`}
						</dd>
					</div>
					<div>
						<dt>Local pitch variation</dt>
						<dd>
							{Math.round(pitch.meanAbsoluteLocalErrorCents)} cents average ·{" "}
							{Math.round(pitch.maxAbsoluteLocalErrorCents)} largest
						</dd>
					</div>
					{timing && (
						<>
							<div>
								<dt>Inferred pace</dt>
								<dd>
									{timing.repeatBpm.toFixed(0)} BPM ·{" "}
									{Math.round((timing.tempoRatio - 1) * 100)}% vs target
								</dd>
							</div>
							<div>
								<dt>Local onset variation</dt>
								<dd>
									{Math.round(timing.medianAbsoluteOnsetErrorMs)} ms median
									{timing.onsetUncertaintyMs !== null
										? ` · about ±${Math.round(timing.onsetUncertaintyMs)} ms capture uncertainty`
										: " · uncertainty unavailable"}
								</dd>
							</div>
						</>
					)}
				</dl>
			)}
			{comparison.issues.length > 0 && (
				<ul className="comparison-issues" aria-label="Evidence limits">
					{comparison.issues.map((issue) => (
						<li key={issue}>{ISSUE_COPY[issue]}</li>
					))}
				</ul>
			)}
			<div className="comparison-feedback">
				{feedback(comparison).map((message) => (
					<p key={message}>{message}</p>
				))}
			</div>
			<p className="rehearsal-boundary">
				These descriptions summarize captured pitch and timing signals. They do
				not assess vocal health, technique, or demonstrated learning.
			</p>
		</div>
	);
}

export function RehearsalPanel(props: RehearsalPanelProps) {
	const { baseline, repeat, comparison, currentTake } = props;
	return (
		<section className="rehearsal-panel" aria-labelledby="rehearsal-title">
			<div className="rehearsal-heading">
				<div>
					<p className="rehearsal-eyebrow">Session-only practice</p>
					<h2 id="rehearsal-title">Rehearsal loop</h2>
				</div>
				{baseline && (
					<button type="button" className="text-button" onClick={props.onReset}>
						Reset rehearsal
					</button>
				)}
			</div>

			{!baseline ? (
				<div className="rehearsal-empty">
					<p>
						Record a microphone take, inspect its evidence, then choose it as
						the target for the next take.
					</p>
					{currentTake && (
						<TakeQuality label="Current take" take={currentTake} />
					)}
					<button
						type="button"
						className="ghost-button"
						disabled={!props.currentTake}
						onClick={props.onStart}
					>
						Use this take as baseline
					</button>
				</div>
			) : (
				<>
					<ol className="rehearsal-steps" aria-label="Rehearsal progress">
						<li className="is-complete">Baseline captured</li>
						<li className="is-complete">Target contour ready</li>
						<li className={repeat ? "is-complete" : "is-current"}>
							{repeat ? "Repeat captured" : "Record a repeat"}
						</li>
						<li className={comparison ? "is-complete" : ""}>Comparison</li>
					</ol>
					<Contour
						baseline={baseline}
						repeat={repeat}
						progress={props.targetProgress}
					/>
					<div className="rehearsal-target-actions">
						<button
							type="button"
							className="ghost-button"
							onClick={
								props.targetPlaying ? props.onStopTarget : props.onPlayTarget
							}
						>
							{props.targetPlaying ? "Stop target" : "Hear target"}
						</button>
						<p>
							The dark contour is the immutable baseline target. Record another
							microphone take to add the accent contour.
						</p>
					</div>
					<div className="rehearsal-quality-grid">
						<TakeQuality label="Baseline" take={baseline} />
						{repeat && <TakeQuality label="Repeat" take={repeat} />}
					</div>
					{comparison && <ComparisonDetails comparison={comparison} />}
				</>
			)}

			<p className="rehearsal-privacy">
				Audio samples and frame-by-frame readings are discarded after analysis.
				This rehearsal summary stays in memory for this tab and clears on reload
				or Reset.
			</p>
		</section>
	);
}

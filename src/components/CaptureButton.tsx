export type CaptureStatus = "idle" | "recording" | "done";

interface CaptureButtonProps {
	status: CaptureStatus;
	onStart: () => void;
	onStop: () => void;
}

const LABELS: Record<CaptureStatus, string> = {
	idle: "Start humming",
	recording: "Stop",
	done: "Hum again",
};

/** Three-state capture control: idle → recording → done. */
export function CaptureButton({ status, onStart, onStop }: CaptureButtonProps) {
	const recording = status === "recording";
	return (
		<button
			type="button"
			className="mic-button"
			data-status={status}
			onClick={recording ? onStop : onStart}
		>
			{recording && <span className="mic-button__dot" aria-hidden="true" />}
			{LABELS[status]}
		</button>
	);
}

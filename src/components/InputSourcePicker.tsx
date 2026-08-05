import type { MidiCapture } from "../hooks/useMidiCapture";

/** Which input is currently armed. */
export type InputSource = "mic" | "midi";

interface InputSourcePickerProps {
	source: InputSource;
	onSelect: (source: InputSource) => void;
	midi: MidiCapture;
	/** Hide controls while a take is in progress. */
	disabled: boolean;
}

/**
 * Input-modality toggle plus the MIDI device picker.
 *
 * Renders nothing at all when the browser has no Web MIDI API — Safari does
 * not ship it, and offering an input that can never connect is worse than
 * offering only the microphone.
 */
export function InputSourcePicker({
	source,
	onSelect,
	midi,
	disabled,
}: InputSourcePickerProps) {
	if (!midi.isSupported) return null;

	return (
		<div className="input-source">
			<div className="input-source__toggle" role="group" aria-label="Input source">
				<button
					type="button"
					aria-pressed={source === "mic"}
					disabled={disabled}
					className={
						source === "mic"
							? "input-source__option is-selected"
							: "input-source__option"
					}
					onClick={() => onSelect("mic")}
				>
					Microphone
				</button>
				<button
					type="button"
					aria-pressed={source === "midi"}
					disabled={disabled}
					className={
						source === "midi"
							? "input-source__option is-selected"
							: "input-source__option"
					}
					onClick={() => onSelect("midi")}
				>
					MIDI keyboard
				</button>
			</div>

			{source === "midi" && (
				<div className="input-source__midi">
					{midi.devices.length === 0 ? (
						<button
							type="button"
							className="ghost-button"
							disabled={disabled}
							onClick={() => void midi.connect()}
						>
							Connect a MIDI keyboard
						</button>
					) : (
						<label className="input-source__device" htmlFor="midi-device">
							<span className="input-source__device-label">Device</span>
							<select
								id="midi-device"
								className="input-source__select"
								value={midi.selectedDeviceId ?? ""}
								disabled={disabled}
								onChange={(event) => midi.selectDevice(event.target.value)}
							>
								{midi.devices.map((device) => (
									<option key={device.id} value={device.id}>
										{device.name}
									</option>
								))}
							</select>
						</label>
					)}

					{midi.error && (
						<p className="input-source__error" role="alert">
							{midi.error}
						</p>
					)}
				</div>
			)}
		</div>
	);
}

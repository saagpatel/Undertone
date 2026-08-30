# Confidence-aware rehearsal

Undertone's rehearsal loop is an upgrade to the existing browser-only melody capture. It uses one completed microphone take as an immutable baseline target, lets the user hear and see that contour, and compares later microphone takes to the same baseline.

## What the comparison means

The comparison describes captured signal patterns:

- **Overall pitch shift** is the median signed pitch difference across aligned notes. A shift is named as a transposition only when it lands within 35 cents of a semitone.
- **Local pitch variation** is calculated after removing that overall shift. This keeps a consistently transposed take from looking like local drift.
- **Inferred pace** comes from median inter-onset spacing. It is not a user-supplied metronome value, so the UI reports uncertainty and lowers confidence for sparse or irregular evidence.
- **Local onset variation** is the residual timing difference after fitting the repeat's overall pace to the baseline.
- **Alignment confidence** combines matched-note coverage, normalized onset/contour fit, voiced-frame share, and pitch-confidence evidence. Equal-count phrases compare in order but do not receive a perfect fit automatically. A single missed or split note can use bounded monotonic time-and-contour alignment, but the result is always uncertainty-limited and receives hypothesis-only feedback; fewer than three matches or a larger count difference fail closed.

Possible octave shifts are labeled as possibilities. The current autocorrelation detector emits one selected pitch rather than a ranked candidate set, so Undertone does not claim that it can identify detector-level octave ambiguity.

These metrics are signal-analysis evidence only. They do not establish vocal health, vocal technique, pedagogical correctness, or a demonstrated learning benefit.

## Privacy and retention

- Audio stays inside the browser's Web Audio graph. Undertone does not upload recordings, call a backend, or train on them.
- Raw audio samples are not stored by the app. Frame-by-frame pitch readings are released immediately after a take is summarized.
- A rehearsal retains only note timing/frequency, aggregate quality counts, the quantized phrase, and comparison metrics in React memory for the current tab.
- Resetting the rehearsal, reloading, or closing the tab clears rehearsal state.
- Rehearsal evidence is not added to IndexedDB, share links, exported files, or the composition codec.
- Inferred rehearsal tempo does not change the existing composition quantization used by save, share, export, or normal playback.
- The existing Library remains separate: it stores a quantized score only when the user explicitly saves it. It never stores captured audio.
- The deterministic evaluation corpus is synthetic and project-owned. No external audio dataset is acquired.

## Failure and uncertainty states

Capture quality distinguishes low-energy unvoiced frames, energetic frames without a stable pitch (background-noise evidence), valid but low-confidence pitch, clipping-threshold samples, explicit out-of-range observations, and insufficient voiced audio. Microphone permission denial, missing devices, busy or unavailable routes, and secure-context failures receive separate recovery-oriented messages.

When evidence is weak, feedback describes what to recheck and does not claim improvement. A passing fixture demonstrates bounded algorithm behavior against expected ranges; it does not demonstrate that rehearsal improves a person's learning.

## Reproduce the local evidence

- `pnpm fixtures:rehearsal` regenerates the project-owned WAV corpus deterministically.
- `pnpm test` runs the clean, transposed, octave, timing, noise, silence, clipping, permission, and state-loop checks against expected ranges.
- On macOS with Google Chrome installed, `pnpm prove:rehearsal` starts an isolated Vite server and disposable headless Chrome profile, exercises the real microphone-analysis flow with deterministic Web Audio input, records visual/accessibility/performance evidence under `artifacts/rehearsal-proof`, then removes its browser profile and stops the server.

The browser proof's macOS `top` POWER value is a relative sampled energy-impact signal. It is not watts, battery-life proof, or production telemetry.

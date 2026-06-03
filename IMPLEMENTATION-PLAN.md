# Undertone — Implementation Plan

> Browser-based musical toy. Hum a melody into your mic — Undertone renders it in real time as hand-scored sheet music, as if your voice revealed a composition hiding in the world. Local-only, zero backend. First browser-audio + procedural-music-notation project for the operator.

---

## Section 1: EXEC SUMMARY

### 1a. What we're building

Undertone is a browser tab that captures a hummed or whistled melody through the device microphone and renders it as a short passage of hand-scored music notation — procedurally generated SVG designed to look as if the ink was always there and you merely uncovered it. The pipeline runs entirely client-side in the browser: Web Audio API for mic capture and real-time pitch detection via autocorrelation on the time-domain signal; a capture loop that assembles a pitch sequence over a few seconds; a quantization layer that maps raw fundamental frequencies to the nearest chromatic note and snaps note onset/duration to a simple rhythmic grid; and a pure-TypeScript procedural SVG renderer that lays out a treble staff with noteheads, stems, and beams in a hand-scored aesthetic. The reveal — the conceit that the composition was always there — is delivered through a timed "ink reveal" animation, not through generated harmony (which is v2). Nothing is sent to a server. Nothing is stored beyond an in-memory phrase buffer, with an optional localStorage export as a stretch in Phase 3.

### 1b. Riskiest parts and de-risking strategy

- **Risk: Autocorrelation pitch detection is unreliable for quiet, breathy, or off-pitch input — the operator's first time using Web Audio.**
  - Severity: HIGH
  - Why it is risky: Autocorrelation on the raw time-domain buffer can produce octave errors, stale readings between notes, and false positives during silence. This is the load-bearing primitive; if pitch detection is wrong, every downstream layer is wrong.
  - Mitigation: Implement in Phase 0 with a live frequency readout rendered to the DOM — the operator can see exactly what the algorithm hears before writing any notation logic. Add a confidence threshold (minimum amplitude RMS + autocorrelation peak strength) that gates note acceptance; values below the threshold are treated as silence, not as a note. Use a 2048-sample analysis buffer at 44.1 kHz (≈46 ms per frame) — enough for clean fundamental detection across the vocal range (C3–C6, ~130–1046 Hz).
  - Fallback: If autocorrelation alone is insufficient, add a zero-crossing-rate pre-filter to reduce noise (still zero-dependency). McLeod Pitch Method (MPM) is a well-understood, MIT-licensed algorithm that can be ported from reference C implementations in ~200 lines of TypeScript — isolated to `src/dsp/pitch.ts` so the swap is local.

- **Risk: Quantization produces musically ugly results — the captured rhythm feels mechanical or wrong.**
  - Severity: MEDIUM
  - Why it is risky: Mapping raw onset/duration timing to a 16th-note grid naively snaps everything to the nearest division, producing dense awkward rhythms when the user pauses unevenly.
  - Mitigation: Use a two-pass quantization strategy: (1) silence-threshold filtering to distinguish genuine note events from breath noise; (2) onset-to-nearest-beat snapping with a ±20% tolerance window, discarding events that don't land close enough to a grid position to feel intentional. Expose the BPM assumption (default 90 BPM, 4/4 time) as a config constant so it's trivially tunable.
  - Fallback: If grid quantization consistently produces unmusical results, fall back to duration-bucket quantization — map duration ranges to fixed note values (>800 ms → half note, 300–800 ms → quarter, 150–300 ms → eighth, <150 ms → sixteenth) without reference to a tempo grid. Less rhythmically accurate but musically more forgiving.

- **Risk: Procedural SVG notation renderer — getting the geometry of noteheads, stems, beams, and staff spacing right is fiddly.**
  - Severity: MEDIUM
  - Why it is risky: Music notation has strict proportional conventions (notehead width, stem length, beam slope, ledger line positioning, accidental clearance) that look obviously wrong if violated. This is also the operator's first notation renderer.
  - Mitigation: Phase 2 builds the renderer incrementally — staff lines first, then noteheads-on-staff, then stems, then beams — with a static fixture phrase as input so visual correctness can be evaluated before the live input pipeline is connected. Use a unit-space coordinate system (1 staff space = 1 unit) to keep geometry math readable; scale to pixels once at the SVG viewport boundary.
  - Fallback: If stems + beams prove too fiddly in the Phase 2 window, ship Phase 2 with stemless open noteheads on staff (still recognizable as notation) and add stems/beams as the first task of Phase 3. The staff + noteheads alone deliver "you hummed → sheet music appears."

- **Risk: Web Audio mic permission UX breaks in some browsers / requires HTTPS in production.**
  - Severity: LOW-MEDIUM (low risk in local dev; medium if deployed)
  - Why it is risky: `getUserMedia` requires a secure context (HTTPS or localhost). Local Vite dev server runs on localhost, so development is fine. Deployment without HTTPS breaks mic access entirely.
  - Mitigation: v1 is local-only (runs in the browser tab, no deploy required). Document clearly in CLAUDE.md and specs that the app must be served from localhost or HTTPS. Add a graceful error state to the UI for denied/unavailable mic permission.
  - Fallback: Not applicable for v1 (local-only scope); for any future deployment, use a static host that provides HTTPS (Vercel/Netlify serve all traffic over TLS).

### 1c. Shortest path to daily personal use

Phase 0 + Phase 1 (≈2 weeks at 10–15 hrs/week) delivers the pipeline foundation: mic → live pitch readout → captured note sequence. That's enough to verify the core signal and use Undertone as a pitch-detection toy. Phase 2 adds the notation renderer — this is the first genuinely shippable creative artifact (hum → see your melody as styled sheet music). Phase 3 polish (reveal animation, playback, export) closes the loop to a shareable creative experience. Each phase checkpoint is a working browser page.

---

## Section 2: REVIEW GATE (SPEC LOCK)

### 2a. Goal

A browser tab where humming or whistling into the mic produces a short passage of hand-scored sheet music rendered as styled SVG notation — treble staff, noteheads, stems, beams — as if the composition was always there and the hum merely revealed it.

### 2b. Success metrics

1. Phase 0: Live frequency readout in the browser updates within 50 ms of the operator humming a note and correctly identifies notes across C3–C6 (±50 cents tolerance).
2. Phase 1: A 4–8 note phrase hummed into the mic is captured as a `Phrase` (array of `NoteEvent` with correct pitch class + octave + duration bucket) within 2 seconds of the final note.
3. Phase 2: The captured `Phrase` renders as an SVG treble-clef melody line with correct staff position per pitch, stems, and beams — first full shippable checkpoint.
4. Phase 3: The reveal animation (notes appear with an ink-drawing effect over ≈1 s) plays on phrase capture; playback uses the Web Audio oscillator to reproduce the hummed melody; SVG export saves the notation image.
5. All processing is client-side; no network request is emitted at any point in the pipeline.

### 2c. Hard constraints

1. **Client-side only** — nothing leaves the browser tab. Zero network requests. No backend, no analytics, no third-party SDKs that phone home.
2. **No notation library** — the procedural SVG renderer is written from scratch in TypeScript. VexFlow, Lilypond, and similar are forbidden. The hand-scored aesthetic is the product.
3. **No v2 harmonization in v1** — the rendered output is the melody the operator hummed, styled to feel discovered. Procedural accompaniment is deferred to v2.
4. **v1 = localhost** — app must work at `localhost:5173` (Vite dev server). HTTPS deploy is out of scope.
5. **Vite + React + TypeScript** — no framework migrations, no other bundlers, no server-side rendering.

### 2d. Locked decisions

- Decision: Pitch detection algorithm.
  - Locked to: Autocorrelation on `AnalyserNode` `getFloatTimeDomainData()` with amplitude + peak-strength confidence gating.
  - Rationale: Zero-dependency, runs in the main thread at 60 fps, sufficient for single-voice melody across the vocal range. McLeod Pitch Method is the documented fallback if autocorrelation proves insufficient — isolated to `src/dsp/pitch.ts` so the swap is local.
  - Failure mode: If autocorrelation produces too many octave errors or stale readings in the operator's environment, swap `detectPitch` to an MPM implementation behind the same `PitchResult` return type — no callers change.

- Decision: Notation renderer.
  - Locked to: Procedural TypeScript functions generating SVG element descriptors, rendered via React JSX to a `<svg>` element.
  - Rationale: The hand-scored aesthetic requires precise control over stroke weight, glyph irregularity, and layout; a library's output is constrained to its own visual conventions. This also makes the renderer the creative work, not a config problem.
  - Failure mode: If stems + beams prove too fiddly in Phase 2 window, ship stemless noteheads on staff (still readable as notation) and carry stems/beams to Phase 3 as its first task.

- Decision: Rhythm quantization strategy.
  - Locked to: Onset-to-nearest-beat snapping at default 90 BPM / 4/4 / 16th-note grid, with ±20% tolerance window; duration-bucket fallback if grid quantization is musically unacceptable.
  - Rationale: Grid quantization at a fixed BPM is the simplest path to recognizable notation; the tolerance window and silence threshold prevent noise events from landing on the grid.
  - Failure mode: If grid quantization feels wrong, the duration-bucket fallback (>800 ms → half, 300–800 ms → quarter, 150–300 ms → eighth, <150 ms → sixteenth) produces musically forgiving results without requiring a BPM assumption.

- Decision: v2 features (WASM, accompaniment, harmonization).
  - Locked to: Deferred to v2 — not in scope for v1.
  - Rationale: WASM adds toolchain complexity; harmonization requires a music theory model that is scope-creep relative to "render the melody you hummed." v1's value is the conceit + the hand-scored notation aesthetic. The IMPLEMENTATION-ROADMAP.md notes v2 hooks where relevant but does not spec them.
  - Failure mode: N/A — these are deliberately deferred; if in-scope pressure arises, invoke `/ultrareview` and escalate.

---

## Section 3: ARCHITECTURE

### 3a. System diagram

```
  MIC INPUT                    DSP LAYER                  NOTATION LAYER            PRESENTATION
  ─────────                    ─────────                  ──────────────            ────────────

  getUserMedia()               src/dsp/pitch.ts           src/notation/
    │                            detectPitch()              layout.ts
    ▼                            (autocorrelation)          notePosition()           React <App>
  AudioContext                   → PitchResult              staffGeometry()             │
    │                            │                          beamGroups()               ▼
    ▼                          src/dsp/capture.ts           accidentals()        <NotationCanvas>
  AnalyserNode                   CaptureSession                │                  (SVG viewport)
    │ getFloatTimeDomainData()   accumulate PitchResults       ▼
    │ (2048 samples, 60 fps)     → RawPhrase             src/notation/           <RevealOverlay>
    │                            │                         render.ts             (CSS ink animation)
    └──────────────────────────► │                         phraseToSVG()
                               src/dsp/quantize.ts           → SVGElementSpec[]
                                 quantizePhrase()                                 <PlaybackEngine>
                                 → Phrase                                         (Web Audio osc,
                                                                                   Phase 3)
```

### 3b. Tech stack

- **React 18** — component layer; `<App>` holds capture state; `<NotationCanvas>` renders SVG.
- **Vite 5** — dev server (localhost:5173) + prod bundle; HMR for rapid notation-render iteration.
- **TypeScript 5 (strict)** — no `any`; strict null checks; `unknown` + narrowing for audio buffer data.
- **Web Audio API** — `AudioContext`, `MediaStreamSource`, `AnalyserNode` (built into every modern browser; zero install).
- **Vitest** — unit test runner for pure DSP functions (pitch math, quantization, notation geometry).
- **Playwright** — optional e2e for the mic-flow UI (Phase 3 stretch; requires headless mic mocking).
- **pnpm** — package manager; `pnpm dev`, `pnpm test`, `pnpm build`.

No external notation libraries. No backend. No persistence SDK. No analytics. No CDN imports.

### 3c. File structure

```
Undertone/
├── src/
│   ├── main.tsx                          # Vite entrypoint; mounts <App>
│   ├── App.tsx                           # root component; capture state machine
│   ├── dsp/
│   │   ├── pitch.ts                      # detectPitch(buffer, sampleRate) → PitchResult
│   │   ├── pitch.test.ts                 # Vitest: autocorrelation against synthetic buffers
│   │   ├── capture.ts                    # CaptureSession: manages AnalyserNode + RAF loop
│   │   ├── capture.test.ts               # Vitest: session state transitions (mock AudioContext)
│   │   ├── quantize.ts                   # quantizePhrase(raw, opts) → Phrase
│   │   └── quantize.test.ts              # Vitest: grid snap, duration buckets, silence filter
│   ├── notation/
│   │   ├── types.ts                      # SVGElementSpec, NotePosition, StaffGeometry
│   │   ├── layout.ts                     # notePosition(), staffGeometry(), beamGroups()
│   │   ├── layout.test.ts                # Vitest: staff position math for all chromatic notes
│   │   ├── accidentals.ts                # accidentalFor(pitch) → sharp | flat | natural | null
│   │   ├── accidentals.test.ts
│   │   ├── render.ts                     # phraseToSVG(phrase, opts) → SVGElementSpec[]
│   │   └── render.test.ts                # Vitest: fixture phrase → expected SVG element tree
│   ├── components/
│   │   ├── NotationCanvas.tsx            # renders SVGElementSpec[] into <svg>
│   │   ├── PitchMeter.tsx                # Phase 0 live frequency readout (debug overlay)
│   │   ├── CaptureButton.tsx             # mic arm/stop/reset control
│   │   └── RevealOverlay.tsx             # Phase 3 ink-reveal CSS animation
│   ├── hooks/
│   │   ├── useAudioCapture.ts            # React hook: owns AudioContext lifecycle
│   │   └── useCapture.ts                 # React hook: drives CaptureSession, returns Phrase
│   └── styles/
│       ├── global.css                    # minimal reset + body background
│       └── notation.css                  # hand-scored aesthetic: paper-tone bg, ink stroke vars
├── tests/
│   └── fixtures/
│       ├── sine-a4.ts                    # synthetic 440 Hz sine buffer for pitch tests
│       ├── silence.ts                    # zero-amplitude buffer (silence detection)
│       └── fixture-phrase.ts             # hardcoded Phrase (C4 quarter, E4 quarter, G4 half)
├── specs/
│   ├── phase-0-validation.md
│   ├── phase-1-validation.md
│   ├── phase-2-validation.md
│   └── phase-3-validation.md
├── index.html                            # Vite HTML template
├── vite.config.ts
├── tsconfig.json
├── vitest.config.ts
├── package.json
├── pnpm-lock.yaml
├── progress.json                         # phase/task status (created Phase 0)
├── tests.json                            # planned test case registry (created Phase 0)
└── CLAUDE.md
```

### 3d. Data model

No persistence layer in v1. All data is in-memory TypeScript types. `localStorage` serialization of the captured phrase is a Phase 3 stretch goal — if added, the stored shape is `JSON.stringify(Phrase)`.

```typescript
// src/dsp/pitch.ts — raw detector output
export interface PitchResult {
  frequency: number;        // fundamental frequency in Hz; 0 = silence / undetected
  confidence: number;       // 0..1 — autocorrelation peak strength; gate at ≥0.9
  rms: number;              // signal RMS; gate at ≥0.01 (silence threshold)
  timestamp: number;        // performance.now() at detection
}

// src/dsp/capture.ts — accumulated raw phrase before quantization
export interface RawNote {
  frequency: number;        // median frequency over the note's duration (Hz)
  onsetMs: number;          // performance.now() when note started
  durationMs: number;       // duration in milliseconds
}
export type RawPhrase = RawNote[];

// src/dsp/quantize.ts — quantized output; canonical phrase representation
export type NoteName = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export type Accidental = 'sharp' | 'flat' | null;
export type NoteValue = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth';

export interface NoteEvent {
  pitch: NoteName;
  accidental: Accidental;
  octave: number;           // 2..7 (C3 = middle-C octave for humming range)
  noteValue: NoteValue;
  beatPosition: number;     // beat offset from phrase start (quarter-note units)
}
export interface Phrase {
  notes: NoteEvent[];
  timeSignatureNumerator: number;   // default 4
  timeSignatureDenominator: number; // default 4
  bpm: number;                      // default 90
}

// src/notation/types.ts — renderer output; consumed by <NotationCanvas>
export interface StaffGeometry {
  x: number; y: number;             // top-left of staff in SVG user units
  width: number;
  lineSpacing: number;              // 1 unit = 1 staff space; default 10 px
  numLines: number;                 // always 5 for treble
}
export type SVGShapeKind = 'line' | 'ellipse' | 'path' | 'text';
export interface SVGElementSpec {
  kind: SVGShapeKind;
  attrs: Record<string, string | number>;
  className?: string;               // maps to CSS for hand-scored stroke styling
}
```

### 3e. Type definitions summary

The complete canonical types are shown in Section 3d above. Key invariants:

- `PitchResult.frequency === 0` encodes silence — callers must not convert 0 Hz to a pitch.
- `NoteEvent.beatPosition` is a floating-point number of quarter-note units from the phrase start (e.g., beat 2.5 = the "and" of beat 2 in 4/4). Quantization ensures all positions are multiples of 0.25 (16th-note grid).
- `SVGElementSpec.attrs` keys are valid SVG attribute names; the renderer does no DOM manipulation — it returns a data structure that React renders via JSX.
- `Phrase` is immutable after quantization — Phase 3 playback and export read from the captured phrase without mutating it.

### 3f. API contracts

**Undertone makes zero outbound network requests.** There are no API calls, no third-party endpoints, no analytics beacons.

The only "API" is the browser platform itself:

| Browser API | Usage | Constraints |
|---|---|---|
| `navigator.mediaDevices.getUserMedia({ audio: true })` | Mic capture | Requires secure context (localhost or HTTPS). Fails gracefully with error state in UI if denied. |
| `AudioContext` + `AnalyserNode` | Time-domain pitch analysis | Must be created in response to a user gesture (click). `fftSize: 2048`, `smoothingTimeConstant: 0`. |
| `requestAnimationFrame` | 60 fps pitch-detection loop | Cancelled via handle when capture stops. |
| `localStorage.setItem / getItem` | Optional phrase export (Phase 3 stretch) | Key: `undertone.lastPhrase`. JSON-serialized `Phrase`. |

Internal module contracts (same-file functions calling each other) are expressed as TypeScript function signatures in Sections 3d–3e.

### 3g. Dependencies with install commands

```bash
# Scaffold
pnpm create vite@latest Undertone -- --template react-ts
cd Undertone

# Dev dependencies (testing)
pnpm add -D vitest @vitest/ui jsdom @testing-library/react @testing-library/user-event
pnpm add -D playwright @playwright/test   # optional e2e (Phase 3)

# No runtime dependencies added beyond what Vite React-TS template includes.
# Web Audio API is a browser built-in — no install.
# All notation rendering is pure TypeScript — no install.

# System (already installed)
# node 20+ (LTS)
# pnpm (via corepack or npm install -g pnpm)
```

Pinned versions (add to `package.json` `devDependencies` after scaffold):

```json
{
  "vitest": "^2.1.0",
  "@vitest/ui": "^2.1.0",
  "jsdom": "^25.0.0",
  "@testing-library/react": "^16.0.0",
  "@testing-library/user-event": "^14.5.0"
}
```

---

## Section 4: PHASED IMPLEMENTATION

## Phase 0: Scaffold + Web Audio + Real-Time Pitch Detection (Week 1)

### Agent Routing
- Recommended: Claude Code
- Rationale: Hands-on, interactive — scaffold setup + first-time Web Audio API plumbing requires tight feedback loops. Pitch detection correctness must be verified by the operator hearing/seeing the live readout.
- Note: Phase 0 is the framework context window — write `tests.json`, `progress.json`, and the `PitchResult` type here; subsequent phases iterate from these artifacts.

### Objectives
- Vite + React + TypeScript scaffold, Vitest configured, pnpm working.
- `useAudioCapture` hook: `getUserMedia` → `AudioContext` → `AnalyserNode` lifecycle (create on user gesture, suspend on stop, close on unmount).
- `detectPitch(buffer, sampleRate)` in `src/dsp/pitch.ts` — autocorrelation on the time-domain float buffer, returning `PitchResult` with frequency + confidence + rms.
- `<PitchMeter>` component: live frequency readout rendered to DOM at 60 fps via `requestAnimationFrame`.
- `progress.json` + `tests.json` written at project root.

### Tasks
1. Scaffold with `pnpm create vite Undertone --template react-ts`; configure Vitest (`vitest.config.ts`, `jsdom` environment); verify `pnpm test` exits 0 on an empty suite.
   - Acceptance: `pnpm dev` opens `localhost:5173`; `pnpm test` runs Vitest; `pnpm build` produces `dist/`.
2. Implement `useAudioCapture.ts` — calls `getUserMedia`, constructs `AudioContext` + `AnalyserNode` (fftSize 2048, smoothingTimeConstant 0), exposes `{ start, stop, analyser, sampleRate }`.
   - Acceptance: Clicking a button in the browser opens the mic permission dialog; AnalyserNode receives data (inspectable via browser DevTools AudioContext panel).
3. Implement `src/dsp/pitch.ts` — `detectPitch(buffer: Float32Array, sampleRate: number): PitchResult` using autocorrelation; confidence = normalized peak strength; rms = root-mean-square of buffer.
   - Acceptance: `pnpm test src/dsp/pitch.test.ts` → synthetic 440 Hz sine buffer → detected frequency within ±5 Hz; silence buffer → `rms < 0.01`, `frequency === 0`.
4. Wire `detectPitch` into a 60 fps `requestAnimationFrame` loop driven by `useCapture.ts`; render frequency + confidence in `<PitchMeter>`.
   - Acceptance: Operator hums into mic → live frequency readout in browser within 50 ms; pitch meter shows correct note name (A4 = 440 Hz) for a sustained hum.
5. Write `progress.json` + `tests.json` at project root.
   - Acceptance: `cat progress.json` → valid JSON with Phase 0 tasks; `cat tests.json` → planned test cases for all phases.

### Phase Verification Checklist
- [ ] `pnpm dev` → app loads at `localhost:5173` with no console errors
- [ ] `pnpm test` → all Vitest tests pass (incl. pitch detection + silence)
- [ ] `pnpm build` → `dist/` produced, no TypeScript errors
- [ ] Live pitch readout in browser: humming A4 shows ~440 Hz within 50 ms
- [ ] Silence → frequency readout shows 0 Hz or "–" (below confidence threshold)
- [ ] `cat progress.json` → valid JSON, Phase 0 tasks "done"
- [ ] `cat tests.json` → valid JSON listing planned tests for all phases

### Risks & Mitigations
- Risk: `getUserMedia` requires user gesture; constructing `AudioContext` outside a click handler triggers browser autoplay policy violation.
  - Mitigation: All `AudioContext` creation is gated behind a button click in `useAudioCapture`. Resume suspended context on re-click.
  - Fallback: If browser still blocks, use `AudioContext.resume()` in the click handler explicitly after creation.
- Risk: Autocorrelation produces octave errors (detecting 880 Hz for a 440 Hz A4 hum).
  - Mitigation: Clamp the search range of the autocorrelation lag to the vocal range (C3–C6, 130–1046 Hz), which bounds the candidate lag window.
  - Fallback: MPM swap in `src/dsp/pitch.ts` behind the same `PitchResult` signature.

### Parallel Dispatch Proposal
- Dispatchable in parallel: Task 3 (detectPitch unit implementation) and Task 2 (useAudioCapture hook) — after Task 1 scaffold.
- Subagent type: coder (Sonnet)
- Dispatch via: `claude agents` (v2.1.139+)
- Rationale: `pitch.ts` is a pure function with no React dependency; `useAudioCapture.ts` is a React hook with no DSP dependency. Both depend only on TypeScript types defined in Task 1.

### Phase Validation Artifact
- File: `specs/phase-0-validation.md`
- Contents: Phase 0 verification checklist as pass/fail conditions.

---

## Phase 1: Pitch Sequence Capture + Quantization (Week 1–2)

### Agent Routing
- Recommended: Claude Code
- Rationale: Quantization math tuning requires the operator to hum at the mic and inspect results — tight interactive feedback loop.

### Objectives
- `CaptureSession` in `src/dsp/capture.ts`: state machine that accumulates `PitchResult` readings over a timed window, detects note onsets/offsets (via confidence + RMS gates), and produces a `RawPhrase`.
- `quantizePhrase(raw, opts)` in `src/dsp/quantize.ts`: maps `RawPhrase` → `Phrase` (chromatic pitch class, octave, quantized note value, beat position).
- `useCapture` hook: drives the capture session lifecycle, returns the current `Phrase` for rendering.
- `<CaptureButton>` UI: arm / recording / done states.

### Tasks
1. Implement `src/dsp/capture.ts` — `CaptureSession` class (or set of pure functions + React-facing hook): accumulates `PitchResult` readings; detects note onset when `confidence ≥ 0.9 && rms ≥ 0.01` for ≥3 consecutive frames; detects note offset on silence or frequency shift >50 cents; records median frequency + onset/duration into a `RawNote`; terminates session on explicit stop or 8-second timeout.
   - Acceptance: `pnpm test src/dsp/capture.test.ts` → fixture sequence of PitchResults (A4 for 400 ms, silence 200 ms, C5 for 600 ms) → RawPhrase with 2 notes; silence-only input → empty RawPhrase.
2. Implement `src/dsp/quantize.ts` — `quantizePhrase(raw: RawPhrase, opts: QuantizeOpts): Phrase`:
   - Frequency → MIDI note number (`69 + 12 * log2(freq/440)`), then → NoteName + Accidental + octave.
   - Onset → nearest 16th-note beat position at `opts.bpm` (default 90) with ±20% tolerance; discard if outside tolerance.
   - Duration → nearest NoteValue by duration-bucket table.
   - Acceptance: `pnpm test src/dsp/quantize.test.ts` → A4 at 440 Hz quantizes to `{ pitch: 'A', accidental: null, octave: 4, noteValue: 'quarter', beatPosition: 0 }`.
3. Wire `CaptureSession` into `useCapture.ts` React hook; expose `{ start, stop, phrase, isCapturing }`.
4. Build `<CaptureButton>` component: three states (idle/recording/done); drives `useCapture`.
   - Acceptance: Click → mic armed → hum → stop → `phrase` populated in React state, inspectable in DevTools.

### Phase Verification Checklist
- [ ] `pnpm test src/dsp/capture.test.ts src/dsp/quantize.test.ts` → all pass
- [ ] A4 hum quantizes to `{ pitch: 'A', octave: 4 }` in DevTools React state
- [ ] 4-note phrase captured and represented as `NoteEvent[]` within 2 s of stopping
- [ ] Silence-only input → empty phrase (not a crash)
- [ ] `<CaptureButton>` cycles idle → recording → done states cleanly

### Risks & Mitigations
- Risk: Note onset/offset detection is too sensitive — every vibrato wobble registers as a new note.
  - Mitigation: Require ≥3 consecutive frames above confidence threshold before registering onset; require ≥5 consecutive frames below threshold before registering offset.
  - Fallback: Increase hysteresis thresholds; expose as tunable constants in `capture.ts` so the operator can adjust without code changes.
- Risk: Quantized beat positions produce unreadable notation (every note on a 16th-note off-beat).
  - Mitigation: Duration-bucket fallback ignores tempo grid entirely; activate if ≥50% of notes miss the ±20% snap window.
  - Fallback: Auto-switch to duration-bucket mode on detection (log a warning to console).

### Parallel Dispatch Proposal
- Dispatchable in parallel: Task 1 (capture session) and Task 2 (quantize) — after `PitchResult` + `RawPhrase` types are defined.
- Subagent type: coder (Sonnet)
- Rationale: `capture.ts` and `quantize.ts` share only the `RawPhrase` type; their implementations are independent and test-isolated.

### Phase Validation Artifact
- File: `specs/phase-1-validation.md`

---

## Phase 2: Procedural SVG Notation Renderer (Week 2–3)

### Agent Routing
- Recommended: Claude Code
- Rationale: Notation geometry is visual — correctness requires the operator to look at the browser output. Interactive build + visual spot-check loop.

### Objectives
- `src/notation/layout.ts`: pure functions — `notePosition(note, staffGeometry)` → y-coordinate on staff; `staffGeometry(width)` → `StaffGeometry`; `beamGroups(notes)` → groups of eighth/sixteenth notes for beaming.
- `src/notation/render.ts`: `phraseToSVG(phrase, geometry) → SVGElementSpec[]` — staff lines, treble clef path, notehead ellipses, stems, beams, accidentals.
- `<NotationCanvas>` component: renders `SVGElementSpec[]` into a `<svg>` with hand-scored CSS styling.
- First full shippable checkpoint: hum → see styled notation in the browser.

### Tasks
1. Implement `src/notation/layout.ts` — `notePosition(note: NoteEvent, geom: StaffGeometry): number` mapping pitch class + octave → y-coordinate (top-of-staff = 0; one staff space = `geom.lineSpacing`); `beamGroups(notes: NoteEvent[]): NoteEvent[][]` grouping consecutive beam-eligible notes (eighth, sixteenth).
   - Acceptance: `pnpm test src/notation/layout.test.ts` → all 12 chromatic notes across octaves 3–6 produce correct staff-line y-positions (verified against standard treble-clef staff position tables); C4 → y = 10 (one ledger line below staff in a 10-px-spacing system).
2. Implement `src/notation/accidentals.ts` — `accidentalFor(pitch: NoteName, accidental: Accidental): 'sharp' | 'flat' | null` and the SVG path string for each glyph (simple geometric approximation, not a font glyph).
   - Acceptance: `pnpm test src/notation/accidentals.test.ts` → F# returns a sharp SVGElementSpec with correct attrs.
3. Implement `src/notation/render.ts` — `phraseToSVG(phrase, geom)`: staff lines (5 horizontal lines), treble clef path (SVG path approximation), notehead ellipses at correct y-positions, stems (vertical lines from notehead center, standard lengths), beams (filled rectangles connecting beamed note stems), accidentals, ledger lines for notes outside the staff.
   - Acceptance: `pnpm test src/notation/render.test.ts` → `fixture-phrase` (C4 quarter, E4 quarter, G4 half) → `SVGElementSpec[]` containing exactly 5 staff lines, 3 noteheads at correct y-coords, stems on quarter notes, no beam on half note.
4. Implement `<NotationCanvas>` — renders `SVGElementSpec[]` to a `<svg viewBox>` with CSS variables for stroke weight, ink color, paper tone; apply `notation.css` hand-scored aesthetic (slightly irregular stroke width via CSS filter or SVG `stroke-dasharray` noise).
   - Acceptance: `fixture-phrase` renders legibly in browser; staff, clef, noteheads, stems visible; hand-scored aesthetic distinguishable from clinical machine-printed notation.
5. Wire `useCapture` → `quantizePhrase` → `phraseToSVG` → `<NotationCanvas>` end-to-end in `App.tsx`.
   - Acceptance: Full pipeline works — hum a 3–5 note phrase, stop, see notation appear.

### Phase Verification Checklist
- [ ] `pnpm test` → all tests pass (incl. layout, accidentals, render)
- [ ] `fixture-phrase` renders in browser: 5 staff lines, treble clef, correct noteheads
- [ ] C4 appears one ledger line below staff; G5 appears one ledger line above staff
- [ ] Stems point up for notes below middle B4; down for B4 and above
- [ ] Full pipeline: hum → stop → notation renders within 500 ms of stop
- [ ] `pnpm build` → no TypeScript errors

### Risks & Mitigations
- Risk: Treble clef path is too complex to approximate as a single SVG path — looks wrong.
  - Mitigation: Use a simplified "stylized" clef (a simplified looped path) rather than a typographically accurate glyph. It reads as a clef without needing an exact glyph.
  - Fallback: Render the clef as a text element using a Unicode music symbol (`𝄞`, U+1D11E) as a temporary stand-in; replace with path in polish phase.
- Risk: SVG notehead ellipses don't read as noteheads — too circular, too regular.
  - Mitigation: Rotate the ellipse ~15° (standard notation practice) and use a slightly wider-than-tall aspect ratio (width/height ≈ 1.4). Apply a subtle hand-scored CSS filter.
  - Fallback: Filled circles with radius tuned to match readability at the render size.

### Parallel Dispatch Proposal
- Dispatchable in parallel: Task 1 (layout), Task 2 (accidentals) — disjoint pure functions.
- Subagent type: coder (Sonnet)
- Rationale: `layout.ts` and `accidentals.ts` share only the `NoteEvent` type; their geometry is independent; both are fully unit-testable without a browser.

### Phase Validation Artifact
- File: `specs/phase-2-validation.md`

---

## Phase 3: Polish — Reveal Animation, Playback, Export (Week 3–4)

### Agent Routing
- Recommended: Claude Code
- Rationale: Animation + playback timing + visual polish require the operator to watch and listen in the browser — interactive judgment calls.

### Objectives
- Reveal animation: notes appear with an ink-drawing effect over ≈1 s after phrase capture (CSS/SVG animation, no library).
- Playback: Web Audio oscillator reproduces the quantized melody (pitch + duration) so the operator can hear the notation they captured.
- Export: SVG download of the rendered notation; optional `localStorage` save of the last phrase.
- Aesthetic tuning: paper-tone background, ink stroke irregularity, final hand-scored feel.

### Tasks
1. Implement `<RevealOverlay>` animation — CSS `stroke-dashoffset` animation on SVG path elements (or an `opacity` + `clip-path` reveal per note group, sequenced with staggered delays) giving the appearance of ink being drawn in, note by note, after capture.
   - Acceptance: Phrase appears note-by-note over ≈1 s with visible ink-drawing motion; re-triggerable on new capture.
2. Implement playback in `useCapture` or a new `usePlayback` hook — `AudioContext.createOscillator()` for each `NoteEvent`; schedule via `AudioContext.currentTime` + note duration; sine wave with slight detune for warmth.
   - Acceptance: Click "play" → oscillator plays back the captured phrase at the correct pitches in sequence; stops cleanly.
3. Implement SVG export — `<a download="undertone.svg">` with `URL.createObjectURL(blob)` of the serialized SVG; optional `localStorage.setItem('undertone.lastPhrase', JSON.stringify(phrase))` on capture complete.
   - Acceptance: "Export" button downloads a valid `.svg` file; file opens in browser/Illustrator and displays the notation.
4. Final aesthetic tuning: paper-tone background (`#f8f4ec`), ink color (`#1a1208`), SVG `filter: url(#roughen)` turbulence filter for stroke irregularity, staff line weight variation.
   - Acceptance: Operator agrees the render reads as hand-scored; side-by-side with clean Helvetica-style notation it is visually distinguishable.

### Phase Verification Checklist
- [ ] Reveal animation plays note-by-note over ≈1 s after capture stops
- [ ] Playback reproduces correct pitches in sequence; stops without audio glitch
- [ ] SVG export downloads a valid file that opens in a browser and shows the notation
- [ ] Paper + ink aesthetic visible: warm background, dark ink, slight stroke irregularity
- [ ] `pnpm test` → all tests still pass (no regressions)
- [ ] `pnpm build` → clean build; no TypeScript errors

### Risks & Mitigations
- Risk: `stroke-dashoffset` animation on complex SVG paths (treble clef, beams) requires accurate `stroke-dasharray` total length — hard to compute for arbitrary paths.
  - Mitigation: Apply the reveal animation only to noteheads + stems (simple shapes with known circumferences); fade the clef and staff in as a unit with a single opacity transition.
  - Fallback: Use a `clip-path` mask animation that wipes across the SVG left-to-right, revealing the entire score at once with a single sweep.
- Risk: `AudioContext.currentTime` scheduling drifts on long phrases — late notes sound wrong.
  - Mitigation: Schedule all notes from a single `startTime = AudioContext.currentTime + 0.05` base; each oscillator start is `startTime + beatPosition * (60 / bpm)` — all offsets computed before scheduling begins.
  - Fallback: Use `setTimeout`-based scheduling (less accurate but adequate for short 4–8 note phrases).

### Parallel Dispatch Proposal
- Dispatchable in parallel: Task 1 (reveal animation), Task 2 (playback), Task 3 (export) — no shared state.
- Subagent type: coder (Sonnet) for Tasks 1–2; coder (Sonnet) for Task 3.
- Rationale: Animation, audio playback, and SVG export are independent surfaces over the same `Phrase` data. Task 4 (aesthetic tuning) is sequential (requires visual judgment) and stays with the lead.

### Phase Validation Artifact
- File: `specs/phase-3-validation.md`

---

## Section 5: SECURITY AND CREDENTIALS

- **Credential storage:** No credentials in scope. Undertone is a local browser toy that authenticates nothing. There is no backend, no API key, no OAuth token, no user account.
- **Data boundaries:** Nothing leaves the browser tab. The only data created is the in-memory `Phrase` (discarded on page reload) and the optional `localStorage` key `undertone.lastPhrase` (browser-local only, no sync). No network requests are made at any point.
- **Sensitive data handling:** The mic captures audio and processes it as time-domain float buffers entirely in-memory. No audio is recorded to disk; no buffer is serialized or transmitted. Phrase data (note names + durations) is not sensitive.
- **Encryption:** Not applicable — no stored secrets, no transmitted data.
- **Token rotation:** Not applicable — no tokens anywhere in the system.
- **Browser permission surface:** The only browser permission used is `navigator.mediaDevices.getUserMedia({ audio: true })`. The app requests this only on explicit user gesture (button click) and releases the stream on stop (`stream.getTracks().forEach(t => t.stop())`). The AudioContext is suspended or closed when capture is not active.
- **Client-side-only data boundary is a hard constraint** — any future change that introduces a network request requires a full security review before landing, regardless of scope.

---

## Section 6: TESTING STRATEGY

**Test stack:** Vitest for unit tests (pure DSP + notation math); Playwright optional for mic-flow e2e (Phase 3 stretch, requires headless mic mocking via browser context API).

**Phase 0**
- Manual: Open `localhost:5173`, click mic button, hum — verify live pitch readout updates.
- Automate: `pitch.test.ts` — synthetic 440 Hz sine buffer detects 440 ±5 Hz; silence buffer returns frequency = 0, rms < 0.01.
- Fixture: `tests/fixtures/sine-a4.ts` — programmatically generated Float32Array of a 440 Hz sine at 44100 Hz, 2048 samples.
- Verify correctness: Confidence ≥ 0.9 on clean sine; confidence < 0.3 on silence buffer.

**Phase 1**
- Manual: Hum a 4-note phrase, stop, inspect React state in DevTools — verify `NoteEvent[]` has correct pitch + note value.
- Automate: `capture.test.ts` — fixture `PitchResult` sequence (A4/400 ms, silence/200 ms, C5/600 ms) → `RawPhrase` with 2 notes. `quantize.test.ts` — A4 at 440 Hz → `{ pitch: 'A', octave: 4, noteValue: 'quarter' }`.
- Fixture: `tests/fixtures/silence.ts` — zero-amplitude buffer; `tests/fixtures/fixture-phrase.ts` — hardcoded `Phrase` (C4 q, E4 q, G4 h).
- Verify correctness: Silence-only capture → empty phrase; no crash on zero-note input.

**Phase 2**
- Manual: `fixture-phrase` rendered in browser — visually inspect staff position, clef, notehead placement, stems. C4 must appear below staff on ledger line.
- Automate: `layout.test.ts` — all chromatic notes C3–C6 produce correct staff-y values against reference table. `render.test.ts` — `fixture-phrase` → `SVGElementSpec[]` with exactly 5 staff lines, 3 noteheads, correct y-coords.
- Fixture: Expected staff-y positions for all 12 chromatic notes in octaves 3–6 (reference lookup table in `layout.test.ts`).
- Verify correctness: C4 one ledger line below staff; G4 on second line; B4 on middle line. Quarter note has stem; half note has open notehead + stem; whole note has open notehead, no stem.

**Phase 3**
- Manual: Full end-to-end — hum → capture → reveal animation plays → click play → hear pitches → click export → open SVG in browser.
- Automate: Regression run `pnpm test` — all Phase 0–3 unit tests pass after polish changes. Playback hook: unit test that `scheduleNote` produces the correct oscillator frequency for A4 (440 Hz) and the correct stop time for a quarter note at 90 BPM (0.667 s).
- Playwright (stretch): If mic mocking is available in the test environment, an e2e test that injects a fixture audio stream and asserts the notation SVG appears in the DOM within 3 s.
- Verify correctness: Export SVG opens in browser with no render errors; `localStorage.getItem('undertone.lastPhrase')` parses as a valid `Phrase` after capture.

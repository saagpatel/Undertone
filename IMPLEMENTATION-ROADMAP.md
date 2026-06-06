# Undertone — Implementation Roadmap

Full architecture + phased build plan. CLAUDE.md is identity; this is the build reference. Source of truth for decisions: `IMPLEMENTATION-PLAN.md` (Sections 1–6).

## Architecture

### System Overview

```
  MIC INPUT           DSP LAYER                   NOTATION LAYER           PRESENTATION
  ─────────           ─────────                   ──────────────           ────────────

  getUserMedia()      src/dsp/pitch.ts             src/notation/
    │                   detectPitch()                layout.ts              React <App>
    ▼                   (autocorrelation)            notePosition()              │
  AudioContext          → PitchResult               staffGeometry()             ▼
    │                   │                           beamGroups()        <NotationCanvas>
    ▼                 src/dsp/capture.ts                                  (SVG viewport)
  AnalyserNode          CaptureSession               src/notation/
    │ getFloat-         accumulate()                 accidentals.ts      <RevealOverlay>
    │ TimeDomainData    → RawPhrase                                      (CSS ink animation,
    │ (2048 smp,         │                           src/notation/        Phase 3)
    │  60 fps)         src/dsp/quantize.ts           render.ts
    │                   quantizePhrase()             phraseToSVG()       <PlaybackEngine>
    └──────────────►    → Phrase ──────────────────► → SVGElementSpec[]  (Web Audio osc,
                                                                          Phase 3)
```

Both capture paths (mic → autocorrelation → capture session → quantize) converge on one `Phrase` data shape, one rendering layer (`notation/render.ts`), and one React SVG viewport. The reveal animation and playback (Phase 3) read from the same immutable `Phrase` without mutation.

### File Structure

```
Undertone/
├── src/
│   ├── main.tsx                          # Vite entrypoint; mounts <App>
│   ├── App.tsx                           # root; capture state machine + layout
│   ├── dsp/
│   │   ├── pitch.ts                      # detectPitch(buffer, sampleRate) → PitchResult
│   │   ├── pitch.test.ts
│   │   ├── capture.ts                    # CaptureSession: AnalyserNode + RAF loop
│   │   ├── capture.test.ts
│   │   ├── quantize.ts                   # quantizePhrase(raw, opts) → Phrase
│   │   └── quantize.test.ts
│   ├── notation/
│   │   ├── types.ts                      # SVGElementSpec, NotePosition, StaffGeometry
│   │   ├── layout.ts                     # notePosition(), staffGeometry(), beamGroups()
│   │   ├── layout.test.ts
│   │   ├── accidentals.ts                # accidentalFor() → SVGElementSpec
│   │   ├── accidentals.test.ts
│   │   ├── render.ts                     # phraseToSVG(phrase, geom) → SVGElementSpec[]
│   │   └── render.test.ts
│   ├── components/
│   │   ├── NotationCanvas.tsx            # renders SVGElementSpec[] into <svg>
│   │   ├── PitchMeter.tsx                # Phase 0: live frequency readout
│   │   ├── CaptureButton.tsx             # arm / recording / done states
│   │   └── RevealOverlay.tsx             # Phase 3: ink-reveal animation
│   ├── hooks/
│   │   ├── useAudioCapture.ts            # owns AudioContext lifecycle
│   │   └── useCapture.ts                 # drives CaptureSession; returns Phrase
│   └── styles/
│       ├── global.css
│       └── notation.css                  # paper-tone bg, ink stroke vars
├── tests/fixtures/
│   ├── sine-a4.ts                        # synthetic 440 Hz sine Float32Array
│   ├── silence.ts                        # zero-amplitude Float32Array
│   └── fixture-phrase.ts                 # Phrase: C4 q, E4 q, G4 h
├── specs/
│   ├── phase-0-validation.md
│   ├── phase-1-validation.md
│   ├── phase-2-validation.md
│   └── phase-3-validation.md
├── index.html
├── vite.config.ts
├── tsconfig.json
├── vitest.config.ts
├── package.json / pnpm-lock.yaml
├── progress.json                         # created Phase 0
├── tests.json                            # created Phase 0
└── CLAUDE.md
```

### Type Definitions

```typescript
// src/dsp/pitch.ts
export interface PitchResult {
  frequency: number;    // Hz; 0 = silence / undetected
  confidence: number;   // 0..1; gate note acceptance at ≥0.9
  rms: number;          // gate silence at ≥0.01
  timestamp: number;    // performance.now()
}

// src/dsp/capture.ts
export interface RawNote {
  frequency: number;    // median Hz over note duration
  onsetMs: number;      // performance.now() at note start
  durationMs: number;   // milliseconds
}
export type RawPhrase = RawNote[];

// src/dsp/quantize.ts
export type NoteName = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B';
export type Accidental = 'sharp' | 'flat' | null;
export type NoteValue = 'whole' | 'half' | 'quarter' | 'eighth' | 'sixteenth';
export interface NoteEvent {
  pitch: NoteName;
  accidental: Accidental;
  octave: number;          // 2..7
  noteValue: NoteValue;
  beatPosition: number;    // quarter-note units from phrase start; multiples of 0.25
}
export interface Phrase {
  notes: NoteEvent[];
  timeSignatureNumerator: number;    // default 4
  timeSignatureDenominator: number;  // default 4
  bpm: number;                       // default 90
}

// src/notation/types.ts
export interface StaffGeometry {
  x: number; y: number;
  width: number;
  lineSpacing: number;    // pixels per staff space (default 10)
  numLines: number;       // always 5
}
export type SVGShapeKind = 'line' | 'ellipse' | 'path' | 'text';
export interface SVGElementSpec {
  kind: SVGShapeKind;
  attrs: Record<string, string | number>;
  className?: string;
}
```

### API Contracts

Undertone makes **zero outbound network requests**. No backend, no analytics, no CDN imports.

| Browser API | Usage | Constraint |
|---|---|---|
| `getUserMedia({ audio: true })` | Mic capture | Requires secure context (localhost or HTTPS). Fails gracefully with error state. |
| `AudioContext` + `AnalyserNode` | Pitch analysis | Must be created in response to user gesture. `fftSize: 2048`, `smoothingTimeConstant: 0`. |
| `requestAnimationFrame` | 60 fps pitch loop | Cancelled via handle on stop. |
| `localStorage` | Optional phrase save (Phase 3) | Key: `undertone.lastPhrase`. JSON `Phrase`. |

### Dependencies

```bash
# Scaffold
pnpm create vite@latest Undertone -- --template react-ts

# Dev dependencies (pinned)
pnpm add -D vitest@^2.1.0 @vitest/ui@^2.1.0 jsdom@^25.0.0
pnpm add -D @testing-library/react@^16.0.0 @testing-library/user-event@^14.5.0
pnpm add -D playwright@latest @playwright/test@latest   # Phase 3 optional e2e

# Runtime: none. Web Audio API is a browser built-in. Notation renderer is pure TS.
```

## Scope Boundaries

**In scope (v1):** mic capture, real-time autocorrelation pitch detection, phrase capture + quantization, procedural SVG notation renderer (staff, treble clef, noteheads, stems, beams), reveal animation, Web Audio playback, SVG export, optional localStorage phrase save.

**Out of scope:** backend, server, database, auth, analytics, notation library, WASM module, any network request.

**Deferred to v2:** WASM harmonic analysis module, procedural accompaniment/harmonization, multi-voice notation, MIDI input, score editing, cloud save.

## Security and Credentials

- No credentials in scope. No API keys, no tokens, no user accounts.
- Nothing leaves the browser tab. Only browser APIs used: `getUserMedia`, `AudioContext`, `localStorage`.
- Mic stream released on stop (`stream.getTracks().forEach(t => t.stop())`); `AudioContext` suspended or closed when inactive.
- Client-side-only data boundary is a hard constraint. Any future network request requires a full security review before landing.

---

## Phase 0: Scaffold + Web Audio + Real-Time Pitch Detection (Week 1)

**Objective:** Vite + React + TypeScript + Vitest scaffold; `useAudioCapture` hook; `detectPitch` autocorrelation implementation; live `<PitchMeter>` in the browser proving the core signal. This is the load-bearing primitive — if pitch detection is wrong, every downstream layer is wrong. Prove it in isolation first.

**Tasks:**
1. Scaffold: `pnpm create vite Undertone --template react-ts`; add Vitest + jsdom; verify `pnpm dev`, `pnpm test`, `pnpm build` all work.
   Acceptance: `pnpm dev` → `localhost:5173`; `pnpm test` → passes on empty suite; `pnpm build` → `dist/` produced.
2. `useAudioCapture.ts`: `getUserMedia` → `AudioContext` → `AnalyserNode` (fftSize 2048, smoothingTimeConstant 0); exposes `{ start, stop, analyser, sampleRate }`.
   Acceptance: Button click → mic permission dialog; `AudioContext.state === 'running'` after grant.
3. `src/dsp/pitch.ts`: `detectPitch(buffer: Float32Array, sampleRate: number): PitchResult` — autocorrelation, lag search clamped to C3–C6 (130–1046 Hz), confidence = normalized peak, rms = buffer RMS.
   Acceptance: `pnpm test src/dsp/pitch.test.ts` → 440 Hz sine → frequency within ±5 Hz, confidence ≥ 0.9; silence → frequency = 0, rms < 0.01.
4. Wire `detectPitch` into 60 fps RAF loop via `useCapture.ts`; render in `<PitchMeter>`.
   Acceptance: Humming A4 → live readout shows ~440 Hz and "A4" within 50 ms.
5. Write `progress.json` + `tests.json`.
   Acceptance: valid JSON; Phase 0 tasks "done".

**Verification checklist:**
- [ ] `pnpm dev` → `localhost:5173`, no console errors
- [ ] `pnpm test` → all Vitest tests pass
- [ ] `pnpm build` → clean build, no TypeScript errors
- [ ] Hum A4 → live readout shows ~440 Hz within 50 ms
- [ ] Silence → readout shows 0 Hz or "–" (below confidence threshold)
- [ ] `cat progress.json` → valid JSON, Phase 0 tasks "done"
- [ ] `cat tests.json` → valid JSON, all phases listed

**Risks:**
- `AudioContext` autoplay policy: all construction behind user gesture in `useAudioCapture`. Resume suspended context on re-click.
- Octave errors in autocorrelation: clamp lag search to C3–C6 range; MPM swap fallback behind same `PitchResult` signature.

**Parallel Dispatch Proposal:**
- Dispatchable in parallel: Task 3 (detectPitch) and Task 2 (useAudioCapture) — after Task 1 scaffold.
- Subagent type: coder (Sonnet). Dispatch via: `claude agents` (v2.1.139+).
- Rationale: `pitch.ts` is a pure function with no React dependency; `useAudioCapture.ts` is React-only with no DSP dependency.

**Phase-end review:** Run `/ultrareview`. Address all findings before marking the phase complete.

---

## Phase 1: Pitch Sequence Capture + Quantization (Week 1–2)

**Objective:** `CaptureSession` accumulates `PitchResult` readings, detects note onset/offset via confidence + RMS gates, produces a `RawPhrase`. `quantizePhrase` maps `RawPhrase` → `Phrase` with chromatic pitch + quantized note value + beat position. `<CaptureButton>` drives the lifecycle. Foundation for notation rendering.

**Tasks:**
1. `src/dsp/capture.ts` — `CaptureSession`: onset = ≥3 consecutive frames with confidence ≥ 0.9 and rms ≥ 0.01; offset = ≥5 frames below threshold or frequency shift > 50 cents; records median frequency + onset/duration; terminates on stop or 8 s timeout.
   Acceptance: `pnpm test src/dsp/capture.test.ts` → fixture PitchResults (A4/400 ms, silence/200 ms, C5/600 ms) → 2 RawNotes; silence-only → empty RawPhrase.
2. `src/dsp/quantize.ts` — frequency → MIDI (69 + 12 × log₂(freq/440)) → NoteName + Accidental + octave; onset → 16th-note beat position at 90 BPM with ±20% snap window; duration → NoteValue bucket.
   Acceptance: `pnpm test src/dsp/quantize.test.ts` → A4 440 Hz → `{ pitch: 'A', accidental: null, octave: 4, noteValue: 'quarter', beatPosition: 0 }`.
3. Wire `CaptureSession` into `useCapture.ts`; expose `{ start, stop, phrase, isCapturing }`.
4. `<CaptureButton>` — idle / recording / done states; drives `useCapture`.
   Acceptance: Click → recording → hum → stop → `phrase` in React state inspectable in DevTools.

**Verification checklist:**
- [ ] `pnpm test src/dsp/capture.test.ts src/dsp/quantize.test.ts` → all pass
- [ ] A4 hum → `{ pitch: 'A', octave: 4 }` in React DevTools state
- [ ] 4-note phrase captured within 2 s of stopping
- [ ] Silence-only → empty phrase, no crash
- [ ] `<CaptureButton>` cycles idle → recording → done cleanly

**Risks:**
- Onset too sensitive (vibrato registers as new note): ≥3-frame onset gate; ≥5-frame offset gate hysteresis.
- Quantized beats all off-beat: auto-switch to duration-bucket fallback if ≥50% of notes miss ±20% snap window.

**Parallel Dispatch Proposal:**
- Dispatchable in parallel: Task 1 (capture), Task 2 (quantize) — after `PitchResult` + `RawPhrase` types defined.
- Subagent type: coder (Sonnet). Dispatch via: `claude agents` (v2.1.139+).

**Phase-end review:** Run `/ultrareview`. Address all findings before marking the phase complete.

---

## Phase 2: Procedural SVG Notation Renderer (Week 2–3)

**Objective:** Pure-TypeScript notation renderer: `layout.ts` maps `NoteEvent` → staff y-position; `render.ts` produces `SVGElementSpec[]` for staff, clef, noteheads, stems, beams, accidentals, ledger lines. `<NotationCanvas>` renders them into an `<svg>`. First full shippable checkpoint: hum → styled sheet music appears.

**Tasks:**
1. `src/notation/layout.ts` — `notePosition(note, geom): number` mapping pitch class + octave → staff y-coordinate (one staff space = `geom.lineSpacing`); `beamGroups(notes): NoteEvent[][]` grouping consecutive eighth/sixteenth notes.
   Acceptance: `pnpm test src/notation/layout.test.ts` → all chromatic notes C3–C6 → correct staff-y values per reference table; C4 (middle C) → one ledger line below staff.
2. `src/notation/accidentals.ts` — `accidentalFor(pitch, accidental)` → SVG path string for sharp/flat glyphs (geometric approximation, not font glyph).
   Acceptance: `pnpm test src/notation/accidentals.test.ts` → F# → sharp SVGElementSpec with correct attrs.
3. `src/notation/render.ts` — `phraseToSVG(phrase, geom): SVGElementSpec[]`: 5 staff lines, treble clef (simplified path or Unicode fallback `𝄞`), notehead ellipses (rotated ~15°, aspect ratio 1.4:1) at correct y-coords, stems (standard lengths, direction by pitch vs B4), beams (filled rects for beamed groups), accidentals, ledger lines for out-of-staff notes.
   Acceptance: `pnpm test src/notation/render.test.ts` → `fixture-phrase` (C4 q, E4 q, G4 h) → exactly 5 staff lines, 3 noteheads at correct y-coords, stems on quarter notes, no beam on half note.
4. `<NotationCanvas>` — renders `SVGElementSpec[]` into `<svg viewBox>` with CSS variables for stroke weight + ink color; apply `notation.css` (paper-tone background `#f8f4ec`, ink `#1a1208`, rotated notehead ellipses).
   Acceptance: `fixture-phrase` renders legibly in browser; hand-scored aesthetic distinguishable from clean machine-printed notation.
5. Wire `useCapture` → `quantizePhrase` → `phraseToSVG` → `<NotationCanvas>` end-to-end in `App.tsx`.
   Acceptance: Hum a 3–5 note phrase → stop → notation renders within 500 ms.

**Verification checklist:**
- [ ] `pnpm test` → all tests pass (layout, accidentals, render)
- [ ] `fixture-phrase` in browser: 5 staff lines, treble clef, correct noteheads
- [ ] C4 one ledger line below staff; G5 one ledger line above staff
- [ ] Stems up for notes below B4; down for B4 and above
- [ ] Full pipeline: hum → stop → notation renders within 500 ms
- [ ] `pnpm build` → no TypeScript errors

**Risks:**
- Treble clef path too complex: use simplified looped path or Unicode `𝄞` temporary stand-in → replace with path in Phase 3 polish.
- Noteheads too circular: rotate ellipse 15°, aspect ratio 1.4:1; SVG filter for hand-scored irregularity.

**Parallel Dispatch Proposal:**
- Dispatchable in parallel: Task 1 (layout), Task 2 (accidentals) — disjoint pure functions.
- Subagent type: coder (Sonnet). Dispatch via: `claude agents` (v2.1.139+).

**Phase-end review:** Run `/ultrareview`. Address all findings before marking the phase complete.

---

## Phase 3: Polish — Reveal Animation, Playback, Export (Week 3–4)

**Objective:** Reveal animation (notes appear as ink-drawing over ≈1 s); Web Audio oscillator playback of captured melody; SVG download export; aesthetic tuning (paper + ink feel). Closes the creative loop — hum → see → hear → share.

**Tasks:**
1. `<RevealOverlay>` — `stroke-dashoffset` animation on noteheads + stems; fade-in for staff + clef; staggered per-note delays so notes appear sequentially over ≈1 s. Re-triggers on new capture.
   Acceptance: Phrase appears note-by-note over ≈1 s with visible ink-drawing motion; re-triggerable.
2. Playback: `usePlayback` hook — schedule Web Audio oscillators per `NoteEvent`; all starts computed from `AudioContext.currentTime + 0.05` base; sine wave + slight detune for warmth; clean stop.
   Acceptance: "Play" → pitches play in sequence at correct notes; stops without audio glitch.
3. SVG export — `<a download="undertone.svg">` + `URL.createObjectURL(blob)` of serialized SVG string; optional `localStorage.setItem('undertone.lastPhrase', JSON.stringify(phrase))` on capture.
   Acceptance: "Export" → downloads valid `.svg`; file opens in browser and shows notation.
4. Aesthetic tuning — paper background (`#f8f4ec`), ink (`#1a1208`), SVG `<feTurbulence>` filter for stroke irregularity, staff-line weight variation via CSS.
   Acceptance: Operator confirms render reads as hand-scored.

**Verification checklist:**
- [ ] Reveal animation plays note-by-note over ≈1 s after capture stops
- [ ] Playback reproduces correct pitches in sequence; stops without glitch
- [ ] SVG export downloads a valid file that opens in browser showing notation
- [ ] Paper + ink aesthetic: warm background, dark ink, slight stroke irregularity
- [ ] `pnpm test` → all tests pass (no regressions)
- [ ] `pnpm build` → clean build

**Risks:**
- `stroke-dashoffset` on clef path — complex path length unknown: apply reveal only to noteheads + stems (simple geometry); opacity-fade the clef as a unit.
- Audio scheduling drift: all oscillator starts computed from single `startTime` base before scheduling — no drift.

**Parallel Dispatch Proposal:**
- Dispatchable in parallel: Task 1 (animation), Task 2 (playback), Task 3 (export) — no shared state.
- Subagent type: coder (Sonnet) for Tasks 1–2–3; Task 4 (aesthetic) stays with lead (visual judgment).
- Dispatch via: `claude agents` (v2.1.139+).

**Phase-end review:** Run `/ultrareview`. Address all findings before marking the phase complete.

---

# v2 — Procedural Harmonization (Phases 4–6)

v1 (Phases 0–3) is complete: hum → quantized melody → hand-scored notation → reveal + playback + export. v2 makes the reveal a **whole composition** — a procedurally-generated accompaniment that fits the melody you actually hummed, heard and seen alongside it.

**Locked v2 decisions** (from the v2 scoping brainstorm, 2026-06-06):

| Decision | Choice | Why |
|----------|--------|-----|
| Harmonization | **Melody-aware functional** — per-slot diatonic chord from the melody's own notes + functional flow + cadence | The harmony reflects *your* melody — that is the reveal. A canned progression is karaoke. |
| Key detection | Krumhansl-Schmuckler profile correlation | Classic, deterministic, zero-dependency, fully unit-testable. |
| Notation phasing | **Chord symbols first (Phase 5), grand staff next (Phase 6)** | Prove the music before the engraving — if the harmony sounds wrong, find out cheap. |
| Accompaniment texture | Block triad + bass root (v2 baseline); arpeggio/style variants deferred | Simplest musical voicing; notation and playback both straightforward. |
| Harmonic vocabulary | Strictly diatonic (no secondary dominants / borrowed chords in v2) | Always-consonant baseline; chromatic color is a later enhancement. |

**Unchanged hard constraints:** client-side only, zero network requests, no backend, no notation library, no WASM (the v1 deferral of WASM harmonics still holds — harmonization is pure TS).

### New type definitions

```typescript
// src/dsp/key.ts
export type Mode = 'major' | 'minor';
export interface Key {
  tonic: NoteName;
  accidental: Accidental;   // sharp/flat tonic spelling, else null
  mode: Mode;
}

// src/dsp/harmony.ts
export interface ChordTone { pitch: NoteName; accidental: Accidental; }
export interface Chord {
  roman: string;            // 'I' | 'ii' | 'IV' | 'V' | 'vi' | 'vii°' (+ minor-mode variants)
  degree: number;           // scale degree 1..7 of the chord root
  root: ChordTone;
  tones: ChordTone[];       // triad pitch classes, root-position
  symbol: string;           // chord-symbol label, e.g. 'C', 'Am', 'G'
  beatPosition: number;     // quarter-note units from phrase start
  beats: number;            // duration in beats (the harmonic rhythm slot)
}
```

Both `Key` and `Chord[]` are pure derivations of an immutable `Phrase` — the harmonization layer never mutates the melody.

---

## Phase 4: Harmonization Engine (pure DSP)

**Objective:** The brain. `detectKey` infers the melody's key; `harmonize` produces a diatonic `Chord[]` chosen from the melody's own notes with functional voice-leading and a closing cadence. No UI — this is the load-bearing primitive, proven in isolation exactly as `detectPitch` was in Phase 0. All pure, all unit-tested.

**Tasks:**
1. `src/dsp/key.ts` — `detectKey(phrase): Key` via Krumhansl-Schmuckler: build a 12-bin pitch-class histogram weighted by each note's duration (beats), correlate against the 24 rotated major/minor key profiles, return the best fit.
   Acceptance: `pnpm test src/dsp/key.test.ts` → a C-major melody (C D E F G A B) → `{ tonic: 'C', mode: 'major' }`; an A-minor melody → `{ tonic: 'A', mode: 'minor' }`; a single-note phrase → a sane key with that note diatonic.
2. `src/dsp/harmony.ts` — `harmonize(phrase, key, opts?): Chord[]`: slice the phrase into harmonic-rhythm slots (default one chord per measure, with a per-beat fallback for sparse/long notes); for each slot pick the diatonic triad scoring highest on melody-tone coverage, biased toward functional motion (I/IV/V anchors, vi/ii pre-dominants) and forced to a cadence (V→I or IV→I) on the final slot.
   Acceptance: `pnpm test src/dsp/harmony.test.ts` → fixture melody in C → first chord contains the tonic when the melody opens on a chord tone; final two chords form an authentic/plagal cadence; every chord is diatonic to the detected key.
3. Chord-symbol formatting in `harmony.ts` — `chordSymbol(chord, key): string` (e.g. `C`, `Dm`, `G`, `Am`); minor-mode and quality suffixes correct.
   Acceptance: I in C → `C`; vi in C → `Am`; V in A-minor → `E` (or `Em` per mode handling, documented).

**Verification checklist:**
- [ ] `pnpm test src/dsp/key.test.ts src/dsp/harmony.test.ts` → all pass
- [ ] Detected key is stable across octave shifts of the same melody
- [ ] Every emitted chord is diatonic to the detected key (no accidental leaks)
- [ ] Final cadence present on every non-empty phrase; empty phrase → `[]`
- [ ] `pnpm build` → no TypeScript errors

**Risks:**
- Key ambiguity on short/atonal hums: K-S still returns a best fit; document that 1–2 note phrases are low-confidence and harmonize conservatively (tonic pedal).
- Melody note outside the chord (passing tone): score by coverage, don't require full containment; never force a non-diatonic chord.

**Phase-end review:** Run `/code-review` (high), inline. Address critical findings before marking the phase complete.

---

## Phase 5: Audible Accompaniment + Chord Symbols

**Objective:** Make the harmony heard and labelled. Extend playback to voice the chords under the melody; print chord symbols above the staff. After this phase: hum → hear melody **and** accompaniment → see the chord changes. The musical engine is validated before any second-staff engraving.

**Tasks:**
1. Extend `usePlayback` (and the pure `dsp/playback.ts` schedule) to also schedule accompaniment voices per `Chord` — block triad + bass root — on the **same** `AudioContext.currentTime` base as the melody (no drift), at lower gain and a softer timbre (e.g. `triangle`) so the melody stays foreground. Clean combined stop.
   Acceptance: `pnpm test src/dsp/playback.test.ts` → schedule includes accompaniment entries at each chord's `beatPosition` with correct chord-tone frequencies and durations; melody + accompaniment share one time base.
2. Chord-symbol layer in the notation — render `Chord.symbol` strings above the staff at each chord's x-position (reuse `notePosition`/beat-to-x mapping). New `SVGElementSpec` text elements, class `chord-symbol`.
   Acceptance: `pnpm test src/notation/render.test.ts` → harmonized fixture → one chord-symbol spec per chord at the expected x; symbols absent when no harmony supplied (v1 render unchanged).
3. Wire `App.tsx`: on capture, `const key = detectKey(phrase); const chords = harmonize(phrase, key);` thread `chords` into `<NotationCanvas>` and `usePlayback`. Export includes chord symbols.
   Acceptance: hum → chord symbols appear above the notation; Play sounds melody + accompaniment; exported SVG contains the symbols.

**Verification checklist:**
- [ ] `pnpm test` → all pass (no v1 regressions; v1 render identical when `chords` is undefined)
- [ ] Play reproduces melody + accompaniment; accompaniment sits under the melody, no clipping, clean stop
- [ ] Chord symbols align horizontally with the notes/beats they govern
- [ ] Exported SVG still valid XML and now shows chord symbols
- [ ] `pnpm build` → clean

**Risks:**
- Accompaniment masking the melody: keep accompaniment gain well below melody; verify by ear (operator gate).
- Symbol collision with high notes/ledger lines: place symbols on a reserved band above the staff with its own vertical offset.

**Phase-end review:** Run `/code-review` (high), inline. Address critical findings before marking the phase complete.

---

## Phase 6: Grand Staff Engraving (the visual reveal)

**Objective:** See the composition, not just hear it. Add a bass-clef staff below the treble, joined by a brace, and engrave the accompaniment there — bass line + stacked chord noteheads aligned to the melody's beats. The reveal animation extends to the lower staff.

**Tasks:**
1. `src/notation/clef.ts` — add `bassClef(geom)`: a drawn bass (F) clef path (the two dots straddling the F3 line), same hand-scored stroke treatment as the treble.
   Acceptance: `pnpm test src/notation/clef.test.ts` → returns a single path spec, finite coordinates, scales with line spacing.
2. Grand-staff geometry — extend `staffGeometry`/layout to a two-staff system (treble + bass, standard gap) with a left brace spanning both; bass-staff y-mapping (`notePositionBass`) for F-clef.
   Acceptance: `pnpm test src/notation/layout.test.ts` → bass-clef reference pitches land on correct lines (F3 = 4th line up, middle C = ledger above bass staff).
3. Accompaniment engraving in `render.ts` — for each `Chord`, draw a bass-clef bass note (root) and the triad as stacked noteheads, vertically aligned to the chord's beat x-position; stems per voice convention.
   Acceptance: `pnpm test src/notation/render.test.ts` → harmonized fixture → bass staff present, one chord stack per chord at the correct x with correct chord-tone y-positions.
4. Reveal animation extends to the bass staff — the lower system fades/draws in with the upper (frame) and per-chord stagger; `prefers-reduced-motion` honoured. Chord symbols from Phase 5 remain (or fold into the engraving).
   Acceptance: capture → both staves ink in; re-triggers per capture; export renders the full grand staff as valid standalone SVG.

**Verification checklist:**
- [ ] `pnpm test` → all pass (v1 single-staff path still works when no harmony)
- [ ] Grand staff renders: treble + bass + brace, vertically aligned by beat
- [ ] Bass clef reads as hand-scored (operator visual gate)
- [ ] Reveal animation covers both staves; reduced-motion shows final state
- [ ] Exported SVG (full score) valid XML, opens standalone
- [ ] `pnpm build` → clean

**Risks:**
- Vertical alignment drift between staves: derive both staves' x from one shared beat-to-x function — single source of truth.
- Viewport height growth: recompute `VIEW_H` for the two-staff system; keep `NOTATION_GEOM` the shared source for canvas + export.
- Bass clef path complexity: same fallback discipline as the treble clef — author, render, screenshot, tune.

**Phase-end review:** Run `/code-review` (high), inline. Address critical findings before marking the phase complete.

---

**Deferred beyond v2:** secondary dominants / borrowed chords, accompaniment style variants (arpeggio, Alberti bass), multi-measure barlines + time-signature engraving, MIDI input, in-app score editing, cloud save. WASM remains out of scope — harmonization is pure TS.

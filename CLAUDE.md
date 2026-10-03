# Undertone

## Overview
Browser-based musical toy. Hum or whistle a melody into your mic — Undertone captures and renders it in real time as hand-scored sheet music, as if your voice revealed a composition the world was always hiding. Local-only, no backend, no install. First browser-audio + procedural-notation project.

The confidence-aware rehearsal upgrade adds a current-tab baseline → target contour → repeat comparison without changing composition persistence or the pure notation renderer. See `REHEARSAL.md` for metric, privacy, retention, and claim boundaries.

## Tech Stack
- React 18 + Vite 6 + TypeScript 5 (strict mode)
- Web Audio API — mic capture via `getUserMedia`, real-time pitch detection via autocorrelation on `AnalyserNode` time-domain data
- Procedural SVG — pure-TS notation renderer (staff, clefs, noteheads, stems, beams, barlines, time signatures)
- IndexedDB — composition library, with an in-memory fallback when storage is blocked
- Vitest — unit tests (pitch math, quantization, SVG layout, codec, storage)
- Playwright (Python) — `scripts/prove-browser.py` drives real Chromium for what jsdom cannot cover: real IndexedDB, zero off-origin requests on the production build, and Web MIDI feature detection

## Development Conventions
- Strict TypeScript: no `any`, `unknown` + narrowing preferred; string-literal unions over enums.
- Errors: log or re-throw — never swallow silently.
- `pnpm` for all package operations; `pnpm dev` to run, `pnpm test` for Vitest, `pnpm build` for prod bundle.
- Conventional commits: `feat:`, `fix:`, `chore:`. Small logical units. Feature branch always — never commit to main.
- All DSP math (autocorrelation, quantization) lives in `src/dsp/` — pure functions, no side effects, fully unit-tested.
- SVG renderer lives in `src/notation/` — pure functions mapping `Phrase` data → SVG element descriptions.
- Persistence lives in `src/storage/` — every tunable in `config.ts`, a typed error hierarchy in `types.ts`, and one `CompositionStore` interface implemented by both stores. `storeContract.ts` exercises the in-memory store; `scripts/prove-browser.py` exercises IndexedDB CRUD and reload persistence in Chromium. Add a store implementation by satisfying that contract, not by writing a parallel suite.

## CC Infrastructure
This project inherits the global CC setup: 34+ skills, agents, hooks, and MCP plugins.
Project-specific overrides only — see IMPLEMENTATION-ROADMAP.md for architecture.

## Current Phase
**v3 is complete. There is no next phase in the roadmap — new scope is an operator decision.**

On `main` as of 2026-08-04: v1 (Phases 0–3), v2 (Phases 4–6), and v3 Phases 7–12 — chromatic
harmony, accompaniment textures, barlines + time signature, local persistence with share links and
file I/O, MIDI keyboard input, and in-app score editing. 408 vitest tests plus 65 browser checks,
all green.

Phases 7–9 were written 2026-06-19 and sat unmerged on branches until 2026-08-04; they are landed
now, so `main` is the single source of truth again.

Two standing caveats:
- **Web MIDI is Chrome/Edge only** — Safari does not ship it. `InputSourcePicker` renders nothing
  when it is absent, and the microphone path is unaffected. Verified both ways in the browser harness.
- **MIDI capture has never been exercised with physical hardware.** The reducer in `src/dsp/midi.ts`
  is exhaustively unit-tested and feature detection is browser-proven, but no keyboard has played
  into it. Test with a real device before treating that path as proven.

Editing respects the locked decision below: the SVG renderer is still a pure `Phrase → SVG`
function. Melody glyphs carry a `noteIndex` for hit-testing, and every edit produces a new
immutable `Phrase` in the React layer. Keep it that way.

See IMPLEMENTATION-ROADMAP.md (the "v3 — Depth, Input, Editing & Persistence" section) for full phase details.

## Key Decisions
| Decision | Choice | Why |
|----------|--------|-----|
| Pitch detection | Autocorrelation on `AnalyserNode` time-domain buffer | Zero-dependency, runs on main thread at 60 fps; sufficient for single-voice melody |
| Notation renderer | Procedural SVG in TypeScript (no library), pure one-way `Phrase → SVG` | Hand-scored aesthetic needs precise glyph control; editing (v3) lives in the React layer, never as a renderer mutation |
| Persistence | v3: client-side only — IndexedDB composition library + file import/export + shareable URL hash | "Cloud save" need solved without a backend; nothing leaves the tab |
| WASM harmonics | Deferred indefinitely | All harmonization (incl. v3 chromatic) is pure TS; WASM not needed |
| Accompaniment | v3: selectable block / arpeggio / Alberti; block is the default (v2 parity) | Texture variety without regressing the proven baseline |
| Harmonic vocabulary | v3: opt-in secondary dominants + borrowed chords, melody-gated; strict-diatonic default | Chromatic color without breaking the always-consonant baseline |

## Phase-Boundary Review
At the end of every phase, run `/code-review` (high) before committing the phase-final code (review inline — the auto-team hook blocks reviewer-agent dispatches). Do not skip on phases that feel small.

## Do NOT
- Do not add a backend — client-side only, nothing leaves the browser tab (v3 persistence/sharing is IndexedDB + URL hash + local files only).
- Do not introduce a notation library (VexFlow, Lilypond, etc.) — the hand-scored SVG renderer is the product.
- Do not make the SVG renderer stateful — it stays a pure `Phrase → SVG` function; v3 editing maps interactions → a new immutable `Phrase` in the React layer.
- Do not add WASM — all DSP, including v3 chromatic harmony, is pure TS.
- Do not add features beyond the roadmap. v3 (Phases 7–12) is complete; the deferred-beyond-v3 list at the roadmap's end stays out of scope until the operator says otherwise.

<!-- portfolio-context:start -->
# Portfolio Context

## What This Project Is

Browser-based musical toy. Hum or whistle a melody into your mic — Undertone captures and renders it in real time as hand-scored sheet music, as if your voice revealed a composition the world was always hiding. Local-only, no backend, no install. First browser-audio + procedural-notation project.

## Current State

**v3 complete.** Capture from microphone or MIDI keyboard, notation, playback, SVG export, key
detection, diatonic and chromatic harmony, accompaniment textures, measure structure, local
persistence with share links, and hand-editing the score are implemented in this checkout. Vitest
tests and the browser proof harness cover these features; rehearsal adds further Vitest coverage.

See IMPLEMENTATION-ROADMAP.md for full phase details.

## Stack

- React 18 + Vite 6 + TypeScript 5 (strict mode)
- Web Audio API — mic capture via `getUserMedia`, real-time pitch detection via autocorrelation on `AnalyserNode` time-domain data
- Procedural SVG — pure-TS notation renderer (staff, clefs, noteheads, stems, beams, barlines, time signatures)
- IndexedDB — composition library, with an in-memory fallback when storage is blocked
- Vitest — unit tests; Playwright (Python) for the real-browser proof harness

## How To Run

```bash
pnpm install --frozen-lockfile
pnpm dev                                # http://localhost:5173
pnpm test                               # vitest
pnpm tsc --noEmit                       # typecheck
pnpm build                              # production bundle
pnpm build && python3 scripts/prove-browser.py   # real-browser checks + screenshots
```

## Known Risks

- Do not add a backend — client-side only, nothing leaves the browser tab. Sharing is a URL hash and local files; zero off-origin requests on share restore are asserted in the browser harness.
- Do not introduce a notation library (VexFlow, Lilypond, etc.) — the hand-scored SVG renderer is the product.
- Do not add features beyond the roadmap; v3 is complete and further scope is an operator decision.

## Next Recommended Move

The roadmap is finished and the Phase 10 gaps are closed, so the next move is an operator decision
rather than queued work. One thing is worth doing before new scope: exercise the Phase 11 MIDI path
with a physical keyboard. It is unit-tested and feature-detected, and the port is now opened
explicitly, but it has never run against real hardware.

<!-- portfolio-context:end -->

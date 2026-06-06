# Undertone

## Overview
Browser-based musical toy. Hum or whistle a melody into your mic — Undertone captures and renders it in real time as hand-scored sheet music, as if your voice revealed a composition the world was always hiding. Local-only, no backend, no install. First browser-audio + procedural-notation project.

## Tech Stack
- React 18 + Vite 5 + TypeScript 5 (strict mode)
- Web Audio API — mic capture via `getUserMedia`, real-time pitch detection via autocorrelation on `AnalyserNode` time-domain data
- Procedural SVG — pure-TS notation renderer (staff, treble clef, noteheads, stems, beams)
- Vitest — unit tests (pitch math, quantization, SVG layout)
- Playwright — optional e2e mic-flow (Phase 3)

## Development Conventions
- Strict TypeScript: no `any`, `unknown` + narrowing preferred; string-literal unions over enums.
- Errors: log or re-throw — never swallow silently.
- `pnpm` for all package operations; `pnpm dev` to run, `pnpm test` for Vitest, `pnpm build` for prod bundle.
- Conventional commits: `feat:`, `fix:`, `chore:`. Small logical units. Feature branch always — never commit to main.
- All DSP math (autocorrelation, quantization) lives in `src/dsp/` — pure functions, no side effects, fully unit-tested.
- SVG renderer lives in `src/notation/` — pure functions mapping `Phrase` data → SVG element descriptions.

## CC Infrastructure
This project inherits the global CC setup: 34+ skills, agents, hooks, and MCP plugins.
Project-specific overrides only — see IMPLEMENTATION-ROADMAP.md for architecture.

## Current Phase
**v3 · Phase 7: Chromatic Harmony (pure DSP)** — v1 (Phases 0–3) and v2 (Phases 4–6) complete and shipped to `main`.
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
- Do not add features beyond the current phase of IMPLEMENTATION-ROADMAP.md (v3 = Phases 7–12; deferred-beyond-v3 list at the roadmap's end stays out of scope).

<!-- portfolio-context:start -->
# Portfolio Context

## What This Project Is

Browser-based musical toy. Hum or whistle a melody into your mic — Undertone captures and renders it in real time as hand-scored sheet music, as if your voice revealed a composition the world was always hiding. Local-only, no backend, no install. First browser-audio + procedural-notation project.

## Current State

**Phase 0: Scaffold + Web Audio + Real-Time Pitch Detection**
See IMPLEMENTATION-ROADMAP.md for full phase details.

## Stack

- React 18 + Vite 5 + TypeScript 5 (strict mode)
- Web Audio API — mic capture via `getUserMedia`, real-time pitch detection via autocorrelation on `AnalyserNode` time-domain data
- Procedural SVG — pure-TS notation renderer (staff, treble clef, noteheads, stems, beams)
- Vitest — unit tests (pitch math, quantization, SVG layout)
- Playwright — optional e2e mic-flow (Phase 3)

## How To Run

- Review the README and top-level scripts before the next session; this repo does not yet expose one canonical run command inside the new context block.

## Known Risks

- Do not add a backend — client-side only, nothing leaves the browser tab.
- Do not build v2 procedural harmonization or accompaniment in v1 — melody-only is the locked scope.
- Do not introduce a notation library (VexFlow, Lilypond, etc.) — the hand-scored SVG renderer is the product.
- Do not add features beyond the current phase of IMPLEMENTATION-ROADMAP.md.

## Next Recommended Move

Use this context plus the README and supporting docs to resume the next active task, then promote the repo beyond minimum-viable by capturing a dedicated handoff, roadmap, or discovery artifact.

<!-- portfolio-context:end -->

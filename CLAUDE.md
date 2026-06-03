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
**Phase 0: Scaffold + Web Audio + Real-Time Pitch Detection**
See IMPLEMENTATION-ROADMAP.md for full phase details.

## Key Decisions
| Decision | Choice | Why |
|----------|--------|-----|
| Pitch detection | Autocorrelation on `AnalyserNode` time-domain buffer | Zero-dependency, runs on main thread at 60 fps; sufficient for single-voice melody |
| Notation renderer | Procedural SVG in TypeScript (no library) | Hand-scored aesthetic requires precise control over glyph paths, weight, irregularity |
| Persistence | None required for v1 (in-memory phrase); optional localStorage export | Local-only constraint; no backend means no sync surface |
| WASM harmonics | Deferred to v2 | v1 melody rendering is the value; WASM adds complexity for harmonization not in scope |
| Accompaniment | Deferred to v2 | v1 renders the melody you hummed only — the "reveal" is delivered by styling + animation |

## Phase-Boundary Review
At the end of every phase, run `/ultrareview` before committing the phase-final code. Do not skip on phases that feel small.

## Do NOT
- Do not add a backend — client-side only, nothing leaves the browser tab.
- Do not build v2 procedural harmonization or accompaniment in v1 — melody-only is the locked scope.
- Do not introduce a notation library (VexFlow, Lilypond, etc.) — the hand-scored SVG renderer is the product.
- Do not add features beyond the current phase of IMPLEMENTATION-ROADMAP.md.

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

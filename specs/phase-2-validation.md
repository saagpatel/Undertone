# Phase 2 Validation — Procedural SVG Notation Renderer

Pass/fail conditions. Read at phase completion, not during implementation.

- [ ] PASS iff `pnpm test src/notation/layout.test.ts` exits 0 — all 12 chromatic notes across octaves 3–6 produce staff y-positions matching the reference treble-clef position table; C4 (middle C) maps to one ledger line below the staff bottom.
- [ ] PASS iff `pnpm test src/notation/accidentals.test.ts` exits 0 — F# produces a `SVGElementSpec` with kind `'path'` and non-empty `attrs.d`; natural (no accidental) returns null.
- [ ] PASS iff `pnpm test src/notation/render.test.ts` exits 0 — `fixture-phrase` (C4 quarter, E4 quarter, G4 half) produces `SVGElementSpec[]` containing exactly 5 staff lines, 3 noteheads, stems on the 2 quarter notes, and no beam on the half note.
- [ ] PASS iff `pnpm test` exits 0 — all Phase 0–2 tests pass (no regressions).
- [ ] PASS iff `pnpm build` exits 0 with no TypeScript errors.
- [ ] PASS iff `fixture-phrase` is displayed in the browser with 5 staff lines, a treble clef symbol, and 3 noteheads visible at distinct vertical positions.
- [ ] PASS iff C4 appears visually one ledger line below the staff; G5 appears one ledger line above the staff.
- [ ] PASS iff stems on quarter notes point upward for notes below B4 and downward for notes at or above B4.
- [ ] PASS iff the half note (G4) renders with an open (unfilled) notehead and a stem; does NOT render a beam.
- [ ] PASS iff the full pipeline works end-to-end: hum a 3–5 note phrase → stop capture → notation SVG appears in the browser within 500 ms of the stop action.
- [ ] PASS iff the notation aesthetic is distinguishable from clean machine-printed output (warm paper-tone background, ink-colored strokes visible in browser).

FAIL on any unchecked box → fix before advancing to Phase 3.

# Phase 0 Validation — Scaffold + Web Audio + Real-Time Pitch Detection

Pass/fail conditions. Read at phase completion, not during implementation.

- [ ] PASS iff `pnpm dev` starts without errors and the app loads at `localhost:5173` with no browser console errors.
- [ ] PASS iff `pnpm test` exits 0 with all Vitest tests passing (incl. `src/dsp/pitch.test.ts`).
- [ ] PASS iff `pnpm build` exits 0 and produces a `dist/` directory with no TypeScript type errors.
- [ ] PASS iff `pnpm test src/dsp/pitch.test.ts` → synthetic 440 Hz sine buffer detects frequency within ±5 Hz and confidence ≥ 0.9.
- [ ] PASS iff `pnpm test src/dsp/pitch.test.ts` → silence buffer (zero amplitude) detects frequency = 0 and rms < 0.01.
- [ ] PASS iff clicking the mic button in the browser opens the `getUserMedia` permission dialog (or activates the mic if already granted).
- [ ] PASS iff humming A4 (440 Hz) into the mic shows a live frequency readout within ±50 cents in `<PitchMeter>` within 50 ms.
- [ ] PASS iff silence → `<PitchMeter>` shows 0 Hz or "–" (confidence below threshold; does not show a spurious note).
- [ ] PASS iff `cat progress.json` is valid JSON with every Phase 0 task marked "done".
- [ ] PASS iff `cat tests.json` is valid JSON listing planned test cases for all phases (0–3).

FAIL on any unchecked box → fix before advancing to Phase 1.

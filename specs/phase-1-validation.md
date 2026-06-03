# Phase 1 Validation — Pitch Sequence Capture + Quantization

Pass/fail conditions. Read at phase completion, not during implementation.

- [ ] PASS iff `pnpm test src/dsp/capture.test.ts` exits 0 — fixture PitchResult sequence (A4 for 400 ms, silence for 200 ms, C5 for 600 ms) produces a `RawPhrase` with exactly 2 `RawNote` entries.
- [ ] PASS iff `pnpm test src/dsp/capture.test.ts` exits 0 — silence-only PitchResult sequence (all rms < 0.01) produces an empty `RawPhrase` without error.
- [ ] PASS iff `pnpm test src/dsp/quantize.test.ts` exits 0 — A4 at 440 Hz + 667 ms duration quantizes to `{ pitch: 'A', accidental: null, octave: 4, noteValue: 'quarter', beatPosition: 0 }` at 90 BPM. (667 ms = one quarter note at 90 BPM; the original 400 ms example was inconsistent — 400 ms maps to an eighth note. Corrected 2026-06-02.)
- [ ] PASS iff `pnpm test src/dsp/quantize.test.ts` exits 0 — C5 (523.25 Hz) quantizes to `{ pitch: 'C', accidental: null, octave: 5 }`.
- [ ] PASS iff `pnpm test` exits 0 — all Phase 0 tests still pass (no regressions).
- [ ] PASS iff humming A4 in the browser, stopping capture, and inspecting React DevTools shows a `Phrase` with `notes[0].pitch === 'A'` and `notes[0].octave === 4`.
- [ ] PASS iff a 4-note phrase is available in React state within 2 seconds of the capture stop action.
- [ ] PASS iff capturing silence only (no humming) produces an empty `notes` array in the phrase — no crash, no spurious notes.
- [ ] PASS iff `<CaptureButton>` cycles through idle → recording → done states visibly without error.
- [ ] PASS iff `pnpm build` exits 0 with no TypeScript errors after Phase 1 additions.

FAIL on any unchecked box → fix before advancing to Phase 2.

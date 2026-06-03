# Phase 3 Validation — Polish: Reveal Animation, Playback, Export

Pass/fail conditions. Read at phase completion, not during implementation.

- [ ] PASS iff after capture stops, the notation appears note-by-note with a visible ink-drawing motion over approximately 1 second (not all-at-once; each note is distinctly sequenced).
- [ ] PASS iff the reveal animation re-triggers cleanly on a new capture — previous notation fades or clears; new notes appear sequentially.
- [ ] PASS iff clicking "Play" causes the Web Audio oscillators to play the captured pitches in the correct sequence; the melody is recognizable as the hummed phrase.
- [ ] PASS iff playback stops cleanly without audible click, pop, or continued sound after the last note's duration elapses.
- [ ] PASS iff clicking "Export" downloads a file named `undertone.svg` (or similar) that opens in the browser or an SVG viewer and displays the notation correctly.
- [ ] PASS iff the exported SVG is valid XML (parseable by the browser's SVG parser without errors).
- [ ] PASS iff `localStorage.getItem('undertone.lastPhrase')` returns a valid JSON string that parses to a `Phrase` with the expected `notes` array after capture.
- [ ] PASS iff the browser background is visibly warm (paper-tone, approximately `#f8f4ec` or similar) and notation strokes are dark ink (approximately `#1a1208`).
- [ ] PASS iff stroke irregularity (turbulence filter or equivalent) is visible — strokes do not appear as perfectly uniform machine-drawn lines at 100% zoom.
- [ ] PASS iff `pnpm test` exits 0 — all Phase 0–3 unit tests pass with no regressions.
- [ ] PASS iff `pnpm build` exits 0 with no TypeScript errors.
- [ ] PASS iff playback scheduling is correct: for a phrase at 90 BPM, a quarter note lasts approximately 667 ms (±50 ms); verified by ear or by unit-testing the `scheduleNote` timing calculation.

FAIL on any unchecked box → feature is incomplete; address before calling Phase 3 done.

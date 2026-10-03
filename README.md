# Undertone

Browser-only melody capture, notation, local score storage, and confidence-aware
rehearsal. See [CLAUDE.md](CLAUDE.md) for architecture and
[REHEARSAL.md](REHEARSAL.md) for signal, privacy, and claim boundaries.

## Setup and run

Use Node.js 22 and pnpm 10.29.2, matching `.github/workflows/ci.yml`. Run from
the repository root:

```bash
pnpm install --frozen-lockfile
pnpm dev
```

Open the printed localhost URL. Microphone capture needs a secure context
(localhost or HTTPS) and explicit permission. Web MIDI is browser/device
conditional; tests alone do not prove physical microphone or MIDI behavior.

## Verification

```bash
pnpm test                               # deterministic Vitest tests
pnpm exec tsc --noEmit                   # focused type check
pnpm build                              # TypeScript + Vite production bundle
pnpm test src/dsp/rehearsal.test.ts       # focused rehearsal fixtures
```

CI runs the frozen install, build, and complete test suite. There is no lint or
format script in `package.json`; do not substitute an unrelated universal gate.

For changed UI, persistence, sharing, or MIDI feature detection, use the existing
browser proof after building:

```bash
python3 -m venv .venv
.venv/bin/python -m pip install playwright
.venv/bin/python -m playwright install chromium
pnpm build
.venv/bin/python scripts/prove-browser.py
```

The harness starts its own Vite dev/preview servers on ports 5173/4173, uses
fresh browser contexts with synthetic scores, and writes screenshots under
`artifacts/browser-proof`. Keep those ports free and run from an isolated
checkout if existing evidence must be retained. It does not grant microphone
permission. Browser checks are conditional on changed behavior; documentation
alone does not require them.

The macOS Chrome rehearsal and physical-microphone proof lanes have additional
prerequisites and write separate artifacts; see
[Reproduce the local evidence](REHEARSAL.md#reproduce-the-local-evidence).
`prove:rehearsal` uses synthetic audio but also samples workstation processes;
`prove:microphones` captures physical ambient input and plays acoustic stimuli.
Run those lanes only for an explicitly requested hardware/performance task.
Synthetic tests and browser fixtures do not establish human comprehension or
learning benefit.

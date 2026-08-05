#!/usr/bin/env python3
"""Phase 10 end-to-end proof, run against a real browser.

The vitest suite proves the codec and the in-memory library. It cannot prove
IndexedDB (jsdom has none) or the "zero network requests" invariant, so this
harness drives real Chromium:

  Act 1 — against the Vite dev server, dynamically import the real storage
          modules in the page and exercise IndexedDbStore against real
          IndexedDB, including survival across a full page reload.
  Act 2 — against a production preview of dist/, cold-load a share link and
          assert the score engraves with no microphone and no network traffic
          beyond the app's own assets.

Exit code is 0 only if every assertion holds.
"""

from __future__ import annotations

import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parent.parent
DEV_PORT = 5173
PREVIEW_PORT = 4173
SHOTS = ROOT / "artifacts" / "phase10"

failures: list[str] = []
checks = 0


def check(label: str, condition: bool, detail: str = "") -> None:
    global checks
    checks += 1
    mark = "PASS" if condition else "FAIL"
    suffix = f"  ({detail})" if detail else ""
    print(f"  [{mark}] {label}{suffix}", flush=True)
    if not condition:
        failures.append(label)


def wait_for(url: str, timeout: float = 60.0) -> None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=2):
                return
        except (urllib.error.URLError, ConnectionError, OSError):
            time.sleep(0.25)
    raise RuntimeError(f"server never came up at {url}")


def serve(args: list[str], url: str) -> subprocess.Popen:
    process = subprocess.Popen(
        args,
        cwd=ROOT,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    wait_for(url)
    return process


# The page-side script for Act 1. Imports the app's real modules through the
# dev server so the code under test is the shipped code, not a copy.
STORE_PROOF = """
async () => {
  const { IndexedDbStore, isIndexedDbAvailable } =
    await import('/src/storage/indexedDbStore.ts');
  const { openCompositionStore } = await import('/src/storage/store.ts');
  const { encodeComposition, decodeComposition } =
    await import('/src/storage/codec.ts');

  const composition = {
    phrase: {
      notes: [
        { pitch: 'C', accidental: null, octave: 4, noteValue: 'quarter', beatPosition: 0 },
        { pitch: 'E', accidental: null, octave: 4, noteValue: 'quarter', beatPosition: 1 },
        { pitch: 'G', accidental: null, octave: 4, noteValue: 'half',    beatPosition: 2 },
        { pitch: 'E', accidental: 'flat', octave: 4, noteValue: 'quarter', beatPosition: 4 },
      ],
      timeSignatureNumerator: 4,
      timeSignatureDenominator: 4,
      bpm: 96,
    },
    key: { tonic: 'C', accidental: null, mode: 'major' },
  };

  // Compare by value, not by JSON text: the decoder builds note objects in its
  // own key order, and JSON.stringify is order-sensitive.
  const stable = (value) =>
    JSON.stringify(value, (_k, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a < b ? -1 : 1))
        : v);

  const out = {};
  out.indexedDbAvailable = isIndexedDbAvailable();

  const store = await openCompositionStore();
  out.kind = store.kind;

  const saved = await store.save('Proof hum', composition);
  out.savedId = saved.id;
  out.savedName = saved.name;

  const loaded = await store.load(saved.id);
  out.loadedMatches = stable(loaded.composition) === stable(composition);

  const second = await store.save('Second take', composition);
  out.listCount = (await store.list()).length;
  out.distinctIds = second.id !== saved.id;

  const renamed = await store.rename(saved.id, 'Renamed hum');
  out.renamed = renamed.name;
  out.renameKeptMusic = stable(renamed.composition) === stable(composition);

  await store.remove(second.id);
  out.afterDeleteCount = (await store.list()).length;

  let missingRenameThrew = false;
  try { await store.rename('ghost', 'x'); } catch { missingRenameThrew = true; }
  out.missingRenameThrew = missingRenameThrew;

  // The record must be a real IndexedDB row, not an in-page cache.
  out.rawRowCount = await new Promise((resolve, reject) => {
    const open = indexedDB.open('undertone');
    open.onsuccess = () => {
      const db = open.result;
      const req = db.transaction('compositions', 'readonly')
        .objectStore('compositions').getAll();
      req.onsuccess = () => { resolve(req.result.length); db.close(); };
      req.onerror = () => reject(req.error);
    };
    open.onerror = () => reject(open.error);
  });

  out.share = encodeComposition(composition);
  out.codecRoundTrips = stable(decodeComposition(out.share)) === stable(composition);
  out.shareBytes = out.share.length;

  store.close();
  return out;
}
"""

RELOAD_PROOF = """
async () => {
  const { openCompositionStore } = await import('/src/storage/store.ts');
  const store = await openCompositionStore();
  const records = await store.list();
  store.close();
  return { count: records.length, names: records.map((r) => r.name) };
}
"""


def main() -> int:
    SHOTS.mkdir(parents=True, exist_ok=True)
    dev = preview = None
    share_payload = ""

    try:
        print("\n=== ACT 1 — real IndexedDB via the dev server ===", flush=True)
        dev = serve(
            ["pnpm", "dev", "--port", str(DEV_PORT), "--strictPort"],
            f"http://localhost:{DEV_PORT}/",
        )

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            page = browser.new_page(viewport={"width": 1280, "height": 1400})
            console_errors: list[str] = []
            page.on(
                "console", lambda m: console_errors.append(m.text) if m.type == "error" else None
            )

            page.goto(f"http://localhost:{DEV_PORT}/", wait_until="networkidle")

            result = page.evaluate(STORE_PROOF)
            share_payload = result["share"]

            check("IndexedDB is available in the browser", result["indexedDbAvailable"])
            check(
                "store selects the durable backend",
                result["kind"] == "indexeddb",
                f"kind={result['kind']}",
            )
            check("save returns a normalized name", result["savedName"] == "Proof hum")
            check("load returns the composition byte-for-byte", result["loadedMatches"])
            check("two saves produce distinct ids", result["distinctIds"])
            check(
                "list sees both records", result["listCount"] == 2, f"count={result['listCount']}"
            )
            check("rename changes the name", result["renamed"] == "Renamed hum")
            check("rename leaves the music untouched", result["renameKeptMusic"])
            check("delete removes exactly one record", result["afterDeleteCount"] == 1)
            check("rename of a missing id throws", result["missingRenameThrew"])
            check(
                "the row is really in IndexedDB, not an in-page cache",
                result["rawRowCount"] == 1,
                f"rows={result['rawRowCount']}",
            )
            check("codec round-trips in a real browser", result["codecRoundTrips"])
            check(
                "a 4-note share payload stays small",
                result["shareBytes"] < 60,
                f"{result['shareBytes']} chars",
            )

            # The whole point of the phase: survive a reload.
            page.reload(wait_until="networkidle")
            after = page.evaluate(RELOAD_PROOF)
            check(
                "the library survives a full page reload",
                after["count"] == 1 and after["names"] == ["Renamed hum"],
                f"{after}",
            )

            check(
                "no console errors during the library run",
                not console_errors,
                "; ".join(console_errors[:3]),
            )

            page.screenshot(path=str(SHOTS / "library-dev.png"), full_page=True)
            browser.close()

        dev.terminate()
        dev.wait(timeout=20)
        dev = None

        print("\n=== ACT 2 — share link cold load on the production build ===", flush=True)
        preview = serve(
            ["pnpm", "preview", "--port", str(PREVIEW_PORT), "--strictPort"],
            f"http://localhost:{PREVIEW_PORT}/",
        )

        with sync_playwright() as pw:
            browser = pw.chromium.launch()
            # No microphone permission is granted anywhere in this act.
            context = browser.new_context(viewport={"width": 1280, "height": 1400})
            page = context.new_page()

            requests: list[str] = []
            page.on("request", lambda r: requests.append(r.url))
            console_errors = []
            page.on(
                "console", lambda m: console_errors.append(m.text) if m.type == "error" else None
            )

            origin = f"http://localhost:{PREVIEW_PORT}"
            page.goto(f"{origin}/#score={share_payload}", wait_until="networkidle")
            page.wait_for_timeout(400)

            noteheads = page.locator("svg .notehead, svg ellipse").count()
            check(
                "a shared score engraves with no microphone",
                noteheads >= 4,
                f"{noteheads} noteheads",
            )

            body = page.inner_text("body")
            check(
                "the app announces the shared score",
                "shared score" in body.lower(),
                body[:80].replace("\n", " "),
            )

            check(
                "the share action is offered",
                page.get_by_role("button", name="Copy share link").count() == 1,
            )
            check(
                "the library panel is present",
                page.get_by_role("heading", name="Library").count() == 1,
            )

            offsite = [u for u in requests if not u.startswith(origin)]
            check(
                "restoring a shared score makes zero off-origin requests",
                not offsite,
                f"{len(offsite)} off-origin",
            )

            check(
                "no console errors on share-link cold load",
                not console_errors,
                "; ".join(console_errors[:3]),
            )

            page.screenshot(path=str(SHOTS / "share-link-cold-load.png"), full_page=True)

            # Changing only the hash is a same-document navigation: the app never
            # remounts. A mount-only effect would leave the previous score on
            # screen, so this asserts the hashchange listener actually fires.
            page.evaluate("() => { window.location.hash = 'score=!!!broken!!!'; }")
            page.wait_for_timeout(400)
            same_tab_alert = page.locator("[role=alert]").inner_text()
            check(
                "a damaged link pasted into an already-open tab reports itself",
                "damaged" in same_tab_alert.lower(),
                same_tab_alert[:70],
            )

            check(
                "a damaged link leaves the score already on screen intact",
                page.locator("svg .notehead, svg ellipse").count() >= 4,
                "a bad link must not destroy the user's current work",
            )

            # A failed save must not report success. An over-long name is a real,
            # reachable rejection path through the actual UI. Return to the valid
            # share link first so there is a score worth saving.
            page.goto(f"{origin}/#score={share_payload}", wait_until="networkidle")
            page.reload(wait_until="networkidle")
            page.wait_for_timeout(500)
            page.fill("#library-name", "x" * 200)
            page.get_by_role("button", name="Save", exact=True).click()
            page.wait_for_timeout(400)
            body_after_failed_save = page.inner_text("body")
            check(
                "a rejected save surfaces an error",
                "cannot exceed" in body_after_failed_save.lower(),
                body_after_failed_save[-90:].replace("\n", " "),
            )
            check(
                "a rejected save does NOT announce success",
                'saved "' not in body_after_failed_save.lower(),
            )
            check(
                "a rejected save adds nothing to the library",
                "nothing saved yet" in body_after_failed_save.lower(),
            )

            # And the ordinary path still reports success.
            page.fill("#library-name", "Good name")
            page.get_by_role("button", name="Save", exact=True).click()
            page.wait_for_timeout(400)
            body_after_good_save = page.inner_text("body")
            check(
                "an accepted save announces success",
                'saved "good name"' in body_after_good_save.lower(),
            )
            check(
                "an accepted save appears in the library list",
                page.get_by_role("button", name="Good name").count() >= 1,
            )
            page.screenshot(path=str(SHOTS / "library-saved.png"), full_page=True)

            # A genuine cold load needs a fresh page with no prior render.
            cold = context.new_page()
            cold.goto(f"{origin}/#score=!!!broken!!!", wait_until="networkidle")
            cold.wait_for_timeout(400)
            alert = cold.locator("[role=alert]").inner_text()
            check(
                "a damaged share link reports itself on cold load",
                "damaged" in alert.lower(),
                alert[:70],
            )
            check(
                "a damaged link renders no score rather than a misleading empty one",
                cold.locator("svg .notehead, svg ellipse").count() == 0,
            )
            cold.screenshot(path=str(SHOTS / "damaged-share-link.png"), full_page=True)
            cold.close()
            page.screenshot(path=str(SHOTS / "damaged-share-link.png"), full_page=True)

            browser.close()

    finally:
        for process in (dev, preview):
            if process and process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=20)
                except subprocess.TimeoutExpired:
                    process.kill()

    print(f"\n=== {checks - len(failures)}/{checks} checks passed ===")
    if failures:
        for label in failures:
            print(f"  FAILED: {label}")
        return 1
    print(f"screenshots: {SHOTS}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

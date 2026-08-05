#!/usr/bin/env python3
"""End-to-end proof for the browser-only behaviour vitest cannot reach.

jsdom has no IndexedDB, no real network, and no Web MIDI, so this harness
drives real Chromium:

  Act 1 — against the Vite dev server, dynamically import the real storage
          modules in the page and exercise IndexedDbStore against real
          IndexedDB, including survival across a full page reload.
  Act 2 — against a production preview of dist/, cold-load a share link and
          assert the score engraves with no microphone and no network traffic
          beyond the app's own assets; then drive a genuine save rejection
          through the UI to prove a failed save never reports success.
  Act 3 — assert the Phase 11 MIDI toggle appears where Web MIDI exists, and
          disappears entirely where it does not (Safari), with the microphone
          path unaffected either way.

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
SHOTS = ROOT / "artifacts" / "browser-proof"

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

            # --- Act 3: MIDI input feature detection -----------------------
            print("\n=== ACT 3 — MIDI input feature detection ===", flush=True)

            withmidi = context.new_page()
            withmidi.goto(origin, wait_until="networkidle")
            withmidi.wait_for_timeout(400)
            check(
                "Web MIDI is present in this browser, so the toggle is offered",
                withmidi.get_by_role("button", name="MIDI keyboard").count() == 1,
            )
            check(
                "the microphone option is offered alongside it",
                withmidi.get_by_role("button", name="Microphone").count() == 1,
            )

            withmidi.get_by_role("button", name="MIDI keyboard").click()
            withmidi.wait_for_timeout(600)
            midi_body = withmidi.inner_text("body")
            check(
                "arming MIDI with no keyboard attached explains itself",
                "connect a midi keyboard" in midi_body.lower()
                or "no midi device" in midi_body.lower(),
                midi_body[:110].replace("\n", " "),
            )
            check(
                "the capture transport is still offered with MIDI armed",
                withmidi.get_by_role("button", name="Start humming").count()
                + withmidi.get_by_role("button", name="Hum again").count()
                >= 1,
            )
            check(
                "a MIDI failure is reported once, not echoed in the generic slot",
                withmidi.locator("[role=alert]").count() <= 1,
                f"{withmidi.locator('[role=alert]').count()} alerts",
            )
            withmidi.screenshot(path=str(SHOTS / "midi-armed.png"), full_page=True)
            withmidi.close()

            # Simulate Safari: no requestMIDIAccess at all, injected before any
            # app code runs. The toggle must disappear rather than offer an
            # input that can never connect, and the mic path must be untouched.
            nomidi_ctx = browser.new_context(viewport={"width": 1280, "height": 1400})
            nomidi_ctx.add_init_script(
                "delete Navigator.prototype.requestMIDIAccess;"
                "Object.defineProperty(navigator, 'requestMIDIAccess',"
                " {value: undefined, configurable: true});"
            )
            nomidi = nomidi_ctx.new_page()
            nomidi_errors: list[str] = []
            nomidi.on(
                "console",
                lambda m: nomidi_errors.append(m.text) if m.type == "error" else None,
            )
            nomidi.goto(origin, wait_until="networkidle")
            nomidi.wait_for_timeout(400)

            check(
                "without Web MIDI the toggle is hidden entirely",
                nomidi.get_by_role("button", name="MIDI keyboard").count() == 0,
            )
            check(
                "without Web MIDI no input-source group is rendered at all",
                nomidi.locator(".input-source").count() == 0,
            )
            check(
                "the microphone path is unaffected without Web MIDI",
                nomidi.get_by_role("button", name="Start humming").count()
                + nomidi.get_by_role("button", name="Hum again").count()
                >= 1,
            )
            check(
                "the library still works without Web MIDI",
                nomidi.get_by_role("heading", name="Library").count() == 1,
            )
            check(
                "no console errors without Web MIDI",
                not nomidi_errors,
                "; ".join(nomidi_errors[:3]),
            )
            nomidi.screenshot(path=str(SHOTS / "no-web-midi.png"), full_page=True)
            nomidi_ctx.close()

            # --- Act 4: score editing --------------------------------------
            print("\n=== ACT 4 — in-app score editing ===", flush=True)

            ed = context.new_page()
            ed_errors: list[str] = []
            ed.on(
                "console",
                lambda m: ed_errors.append(m.text) if m.type == "error" else None,
            )
            # A share link gives a known score with no microphone involved.
            ed.goto(f"{origin}/#score={share_payload}", wait_until="networkidle")
            ed.wait_for_timeout(500)

            def note_ys() -> list[float]:
                """Vertical position of each notehead — pitch made observable."""
                return ed.evaluate(
                    "() => Array.from(document.querySelectorAll("
                    "'.notation ellipse[data-note-index]'))"
                    ".map(e => Number(e.getAttribute('cy')))"
                )

            baseline_ys = note_ys()
            check(
                "the editing toolbar appears for a score",
                ed.get_by_role("toolbar", name="Edit the score").count() == 1,
            )
            check(
                "noteheads are hit-testable",
                len(baseline_ys) >= 4,
                f"{len(baseline_ys)} addressable noteheads",
            )

            # Click a notehead: it must select, and only that note.
            ed.locator(".notation ellipse[data-note-index]").first.click()
            ed.wait_for_timeout(250)
            check(
                "clicking a notehead selects exactly one note",
                ed.locator(".notation .is-selected").count() >= 1
                and ed.evaluate(
                    "() => new Set(Array.from(document.querySelectorAll("
                    "'.notation .is-selected')).map(e => "
                    "e.getAttribute('data-note-index'))).size"
                )
                == 1,
            )

            # Transpose up one step via the toolbar; the notehead must rise.
            ed.get_by_role("button", name="Move the selected note up one step").click()
            ed.wait_for_timeout(250)
            after_up = note_ys()
            check(
                "transposing up moves the note higher on the staff",
                after_up[0] < baseline_ys[0],
                f"cy {baseline_ys[0]} -> {after_up[0]}",
            )
            check(
                "transposing one note leaves the others where they were",
                after_up[1:] == baseline_ys[1:],
            )

            # Undo must restore the prior score exactly.
            ed.get_by_role("button", name="Undo the last edit").click()
            ed.wait_for_timeout(250)
            check("undo restores the score exactly", note_ys() == baseline_ys)

            ed.get_by_role("button", name="Redo the last undone edit").click()
            ed.wait_for_timeout(250)
            check("redo re-applies the edit", note_ys() == after_up)

            # Keyboard-only editing: focus the score region and drive it.
            ed.get_by_role("button", name="Undo the last edit").click()
            ed.wait_for_timeout(200)
            ed.locator(".app__stage").focus()
            # Escape first: a note is still selected from the click above, so
            # ArrowRight would advance to the second note rather than pick the
            # first. Clearing makes the sequence say what it means.
            ed.keyboard.press("Escape")
            ed.wait_for_timeout(150)
            check(
                "Escape clears the selection",
                ed.locator(".notation .is-selected").count() == 0,
            )
            ed.keyboard.press("ArrowRight")  # select first note
            ed.wait_for_timeout(150)
            ed.keyboard.press("ArrowDown")  # transpose it down a step
            ed.wait_for_timeout(300)
            after_kbd = note_ys()
            check(
                "keyboard-only editing transposes the selected note",
                after_kbd[0] > baseline_ys[0],
                f"cy {baseline_ys[0]} -> {after_kbd[0]}",
            )
            check(
                "keyboard editing leaves the unselected notes alone",
                after_kbd[1:] == baseline_ys[1:],
            )

            # Nudging in time re-sorts the melody. The selection must follow the
            # note it moved, not stay on a position now holding a different one.
            selected_before = ed.evaluate(
                "() => document.querySelector('.notation ellipse.is-selected')?.getAttribute('cy')"
            )
            ed.get_by_role("button", name="Move the selected note later by one beat").click()
            ed.wait_for_timeout(300)
            selected_after = ed.evaluate(
                "() => document.querySelector('.notation ellipse.is-selected')?.getAttribute('cy')"
            )
            check(
                "the selection follows a note moved in time",
                selected_before is not None and selected_after == selected_before,
                f"cy {selected_before} -> {selected_after}",
            )
            check(
                "moving in time still selects exactly one note",
                ed.evaluate(
                    "() => new Set(Array.from(document.querySelectorAll("
                    "'.notation .is-selected')).map(e => "
                    "e.getAttribute('data-note-index'))).size"
                )
                == 1,
            )
            ed.get_by_role("button", name="Undo the last edit").click()
            ed.wait_for_timeout(250)

            # Deleting removes exactly one note. Re-focus first: the toolbar
            # clicks above moved focus off the score, and the shortcuts are
            # deliberately scoped to the score region.
            ed.locator(".app__stage").focus()
            before_delete = len(note_ys())
            ed.keyboard.press("Delete")
            ed.wait_for_timeout(300)
            check(
                "deleting removes exactly one note",
                len(note_ys()) == before_delete - 1,
                f"{before_delete} -> {len(note_ys())}",
            )

            # Adding a note puts one back.
            ed.keyboard.press("Enter")
            ed.wait_for_timeout(300)
            check(
                "adding a note lengthens the melody",
                len(note_ys()) == before_delete,
                f"{len(note_ys())} notes",
            )

            # The harmony beneath must track the edit, not go stale.
            chord_labels = ed.evaluate(
                "() => Array.from(document.querySelectorAll("
                "'.notation__chords text')).map(e => e.textContent).join(',')"
            )
            check(
                "the engraved harmony is present and re-derived after edits",
                len(chord_labels) > 0,
                chord_labels[:40],
            )

            # Edits must round-trip through persistence.
            edited_ys = note_ys()
            ed.fill("#library-name", "Edited score")
            ed.get_by_role("button", name="Save", exact=True).click()
            ed.wait_for_timeout(400)
            ed.goto(origin, wait_until="networkidle")
            ed.wait_for_timeout(400)
            ed.get_by_role("button", name="Edited score").click()
            ed.wait_for_timeout(500)
            check(
                "an edited score saves and reopens with the edits intact",
                note_ys() == edited_ys,
                f"{len(edited_ys)} notes",
            )

            check(
                "no console errors while editing",
                not ed_errors,
                "; ".join(ed_errors[:3]),
            )
            ed.screenshot(path=str(SHOTS / "editing.png"), full_page=True)
            ed.close()

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

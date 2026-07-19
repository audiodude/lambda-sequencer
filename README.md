# λ-SEQ

Browser-based modular MIDI sequencer. Single-file Vue 3 app. Double-click/open `index.html` and go.

## Development

**For development only:** Serve the directory with any static server (`python3 -m http.server` works fine) and open it in a browser with WebMIDI support (Chrome / Edge). This is not necessary to simply use Lambda Sequencer, you can just double-click index.html in that case.

## Testing

The automated suite runs the shipped `index.html` in headless Chromium via
Playwright — no build step, no MIDI hardware (WebMIDI is stubbed). One-time
setup, then run:

    npm install
    npx playwright install chromium
    npm test             # fast suite: unit + browser regression
    npm run test:audio   # Viktor synth engine tests (slower)
    npm run test:all     # everything (what CI runs)

The suite covers the music-theory helpers, every module's signal handler,
patch save/load migrations, device name-resolution and the remap modal,
external MIDI clock, panic discipline, EXPORT APP round-trips, and STEP
mute/skip gestures (the assertion checklists from issue #4). Test-only access
to script-scoped functions goes through the frozen `window.__SEQ_TEST__`
handle at the bottom of `index.html` (the mounted app itself is
`window.__SEQ`). CI runs everything on every push and pull request
(`.github/workflows/test.yml`).

## EXPORT APP

The **EXPORT APP** button in the top bar downloads a single self-contained HTML file containing the entire app *plus the current patch*. The Vue runtime is already inlined in the source, so the export has no external dependencies and no `_files/` sidecar directory.

To use it:

1. Build the patch you want (modules, cables, params).
2. Click **EXPORT APP** — a file named `lambda-seq-<timestamp>.html` downloads.
3. Move that file anywhere (Dropbox, a USB stick, another machine). Double-click it.

It opens directly in the browser — no server, no network — and boots with the exact patch you exported. The embedded patch wins over any `localStorage` on that machine, so the snapshot is portable.

Note: WebMIDI requires a secure context. `file://` works in Chrome on macOS, but on other browsers or stricter Chrome configs you may need to serve the file over `localhost` for MIDI to function. The UI itself works fine either way.

The two adjacent buttons are **SAVE PATCH** (downloads the current patch as JSON) and **LOAD PATCH** (loads one back in).

## Built-in synth (Viktor NV-1)

λ-SEQ embeds the [Viktor NV-1](https://github.com/nicroto/viktor-nv1-engine)
synth engine (MIT), so patches can make sound with no MIDI device at all. Add a
**VIKTOR** module and cable notes into it like a MIDI OUT — up to four
of them, each with its own patch and volume (they share one output limiter).
The synth page stacks a panel per module; **OPEN** on a rack module jumps to
its panel. The top bar's
**RACK | BOTH | VIKTOR** switcher shows the rack, the synth page (64 factory
patches + volume), or both side by side.

Everything runs offline inside the single HTML file — the engine is inlined and
the reverb impulse is synthesized at load, so no network is ever touched. Audio
starts after your first click (browser autoplay policy). Note timing for the
built-in synth rides the JS main thread (a few ms of jitter), unlike hardware
MIDI out which is scheduled by the OS — see `learnings.md` for the analysis.

The vendored engine bundle is regenerated with `tools/build-viktor-bundle.sh`
(pins the upstream commit; documents the four build-time patches).

The built-in demo song (what boots with no autosave) is swapped with
`tools/set-default-patch.sh <patch.json> [index.html]` — feed it a patch
exported with SAVE.

## Pattern recall (PATTRIG)

**PATTRIG** is a pattern bank mapped like a drum kit — snapshot STEP
patterns into sequential note slots (C0, C#0, D0…), then recall them live
by pitch.

1. Add a PATTRIG — STEPs only show their `pat` jacks and **SNAPSHOT** button
   while one is on the canvas, so patches without pattern recall stay
   uncluttered.
2. Build a pattern on an "editor" STEP, patch its `pat` output into the
   PATTRIG's `pat` input, and click the STEP's **SNAPSHOT** button — the
   pattern lands on the next free slot (first C0, then C#0, and so on; the
   **NEXT** readout shows where the next one goes). Repeat for each pattern
   you want in the bank. Each row lists its note and the module type it was
   captured from.
3. Patch the PATTRIG's `pat` output into a "player" STEP's `pat` input, and
   any note source into the PATTRIG's `note` input — sending a learned note
   now reconfigures that STEP's pattern live (unknown notes are ignored).
   Clicking a row sends its pattern directly, no note needed.
4. **LOCK** stops further captures (learned notes still recall). Each row's
   **×** clears a slot — clearing the newest row frees it for re-capture
   (undo), while a cleared middle slot stays empty so learned notes never
   shift.

## Device remapping

Patches reference MIDI devices by **name** so they stay portable across machines (WebMIDI port ids differ per machine/browser). On load, λ-SEQ resolves each name to a live port. If a name can't be found, it prompts you to map it to one of your devices — pick a target once and every module that used that name is remapped.

Caveat: renaming a device in the OS won't be picked up until you fully restart the browser (Chrome caches the MIDI list per process and ignores renames). Routing is unaffected — it's keyed to the device id, not the name.

## Post-commit hook

The repo ships a post-commit hook in `hooks/` that stamps the current short commit hash into the page header. To activate it on a fresh clone, run once:

```
git config core.hooksPath hooks
```

The hook amends the commit after stamping, so the hash shown in the header is the *pre-amend* hash — off by one but always close. This is unavoidable at commit time (a commit can't contain its own hash), so treat a bare hash as "dev copy, roughly here".

The deployed site is exact: the Pages workflow re-stamps the header at deploy time with `v_<hash>` of the released commit — the same string as the release tag — so the live header tells you precisely which release you're on.

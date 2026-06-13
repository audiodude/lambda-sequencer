# λ-SEQ

Browser-based modular MIDI sequencer. Single-file Vue 3 app. Double-click/open `index.html` and go.

## Development

**For development only:** Serve the directory with any static server (`python3 -m http.server` works fine) and open it in a browser with WebMIDI support (Chrome / Edge). This is not necessary to simply use Lambda Sequencer, you can just double-click index.html in that case.

## EXPORT APP

The **EXPORT APP** button in the top bar downloads a single self-contained HTML file containing the entire app *plus the current patch*. The Vue runtime is already inlined in the source, so the export has no external dependencies and no `_files/` sidecar directory.

To use it:

1. Build the patch you want (modules, cables, params).
2. Click **EXPORT APP** — a file named `lambda-seq-<timestamp>.html` downloads.
3. Move that file anywhere (Dropbox, a USB stick, another machine). Double-click it.

It opens directly in the browser — no server, no network — and boots with the exact patch you exported. The embedded patch wins over any `localStorage` on that machine, so the snapshot is portable.

Note: WebMIDI requires a secure context. `file://` works in Chrome on macOS, but on other browsers or stricter Chrome configs you may need to serve the file over `localhost` for MIDI to function. The UI itself works fine either way.

The two adjacent buttons are **SAVE PATCH** (downloads the current patch as JSON) and **LOAD PATCH** (loads one back in).

## Device remapping

Patches reference MIDI devices by **name** so they stay portable across machines (WebMIDI port ids differ per machine/browser). On load, λ-SEQ resolves each name to a live port. If a name can't be found, it prompts you to map it to one of your devices — pick a target once and every module that used that name is remapped.

Caveat: renaming a device in the OS won't be picked up until you fully restart the browser (Chrome caches the MIDI list per process and ignores renames). Routing is unaffected — it's keyed to the device id, not the name.

## Post-commit hook

The repo ships a post-commit hook in `hooks/` that stamps the current short commit hash into the page header. To activate it on a fresh clone, run once:

```
git config core.hooksPath hooks
```

The hook amends the commit after stamping, so the hash shown in the header is the *pre-amend* hash — off by one but always close.

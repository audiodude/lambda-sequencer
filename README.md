# λ-SEQ

Browser-based modular MIDI sequencer. Single-file Vue 3 app — open `index.html` and go.

## Development

Serve the directory with any static server (`python3 -m http.server` works fine) and open it in a browser with WebMIDI support (Chrome / Edge).

## Post-commit hook

The repo ships a post-commit hook in `hooks/` that stamps the current short commit hash into the page header. To activate it on a fresh clone, run once:

```
git config core.hooksPath hooks
```

The hook amends the commit after stamping, so the hash shown in the header is the *pre-amend* hash — off by one but always close.

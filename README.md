# λ-SEQ — Lambda Sequencer

A browser-based modular sequencer with eurorack-style patch cables. Outputs MIDI only — bring your own synth (hardware, software, or a virtual MIDI bus).

## Run

WebMIDI requires a **secure context**, so this needs to be served over HTTPS (a self-signed cert on localhost is fine).

```bash
# one-time: generate a self-signed cert
mkdir -p .cert
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout .cert/key.pem -out .cert/cert.pem -days 365 \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"

# start the server
python3 serve.py 8443
```

Open **https://localhost:8443/** (or `https://<your-lan-ip>:8443/` from another device on the network — `serve.py` binds `0.0.0.0`). Click through the self-signed-cert warning ("Advanced → Proceed").

Pick a MIDI output device from the top bar. Hit **PLAY** (or `Space`).

## Use

- **Add modules** from the palette at the top.
- **Drag a jack onto another jack** to patch. Cables only connect matching signal types (color-coded).
- **Right-click** (or **double-click**) a cable to delete it.
- **Drag a module's title bar** to reposition it.
- **Click the ✕** on a module to remove it.
- **PANIC** sends all-notes-off on all 16 channels.
- **SAVE / LOAD** export/import the patch as JSON.
- **Space** toggles play/stop.

### Modules

| | |
|---|---|
| **CLOCK** | master tempo + transport. Optional 24 PPQN MIDI Clock out. |
| **DIV** | divides (or multiplies) an incoming clock — polyrhythm fuel. |
| **STEP SEQ** | 1–16 step grid. Click to toggle, scroll-wheel to set semitone offset, right-click to clear. |
| **EUCLID** | Euclidean rhythm — steps / pulses / rotation knobs. |
| **KEY** | sets global root + scale. Broadcasts implicitly to all QUANT and CHORD modules. Patch the SCALE jack to override per-module. |
| **QUANT** | snaps incoming pitch to the active scale. |
| **CHORD** | builds a scale-aware chord from incoming pitch (triad, 7th, sus2/4, 9th; voices; inversion). Pitch output is polyphonic. |
| **MIDI OUT** | emits Note On/Off on a chosen channel, with adjustable gate length. |

### Signal types (jack colors)

- ⚪ white — **clock** (tick events)
- 🟡 yellow — **gate** (note-on triggers)
- 🔵 blue — **pitch** (MIDI note number, possibly polyphonic)
- 🔴 pink — **velocity** (1–127)
- 🟣 purple — **scale** (root + scale, from KEY)

## Develop

Single-page app, no build step. ES modules straight to the browser.

```
index.html          shell
style.css           eurorack faceplate styling
js/main.js          entry, MIDI setup, transport, save/load
js/scheduler.js     16th-note lookahead clock
js/modules.js       module definitions + render + tick
js/rack.js          drag, patch cables, graph evaluation
js/music.js         scales, quantize, chord builder
test/test.mjs       pure-helper unit tests
```

Run tests:

```bash
node test/test.mjs
```

# Viktor NV-1 Embed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Embed the Viktor NV-1 synth engine into λ-SEQ's single-file index.html as a built-in note destination (VIKTOR module) with a RACK | BOTH | VIKTOR view switcher.

**Architecture:** A vendored esbuild IIFE bundle (`NV1` global, ~177 KB) sits in its own `<script>` block like the inlined Vue runtime. A readable shim in the main app script owns lifecycle (lazy gesture-gated init), a synthesized reverb impulse, note timing (hold-on-a-timer, see learnings.md analysis), and panic. A `VIKTOR` entry in the `TYPES` registry + a rack module component + a right-hand synth pane complete the UI.

**Tech Stack:** Vue 3 (inlined), Web Audio, esbuild (build-time only), headless Chrome for verification.

**Spec:** `docs/superpowers/specs/2026-07-01-viktor-embed-design.md`

## Global Constraints

- Single-file, fully offline: index.html makes zero network requests; `file://` double-click works; EXPORT APP output self-contained.
- index.html growth ≤ ~190 KB (bundle 177 KB + ~10 KB shim/UI). Current size: 921,790 bytes.
- Max ONE VIKTOR module per patch (same guard as CLOCK).
- MVP UI = patch selector + volume only. No knob panel, no multi-instance, no engine timing fork.
- Engine bundle is upstream-faithful except 4 documented build patches (impulse path, tuna fallback, midiController.init removal, defaultPatches export).
- Repo conventions: work directly on `main`; post-commit hook (active) stamps the header hash and amends — expected. Commit ONLY files this plan touches (user has unrelated uncommitted changes: `demos/`, `video-scripts.md` — never `git add` those).
- No test framework exists. Verification = headless Chrome harness (learnings.md idiom). Chrome binary: `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` (verify exists in Task 1; if missing, stop and report).
- Scratch dir for harness/bundle artifacts: `/private/tmp/claude-501/-Users-tmoney-code-vibes-lambda-sequencer/66559b20-0f75-47a1-bee5-e3d99bc0aa24/scratchpad` (referred to as `$SCRATCH` below). A clean engine clone already exists at `$SCRATCH/viktor-nv1-engine`.

## index.html geography (line numbers pre-change)

| anchor | line |
|---|---|
| head third-party attribution comment | ~5 |
| CSS `:root` vars | 35–49 |
| `#stage` CSS | 137 |
| `.module.MIDIOUT .activity` CSS | 822–833 |
| `#palette` CSS | 836 |
| tmpl-app root `<div>` | 1025 |
| topbar zoom-ctrl end / `.right` div | 1041–1042 |
| `#stage` markup | 1058 |
| `#palette` markup | 1111 |
| tmpl-midiout template | 1885–1925 |
| Vue runtime blob (777 KB single line, inside its own `<script>`) | 1928 |
| `SIGNAL_COLORS`/`PALETTE`/`SAVE_KEY` | 1970–1993 |
| `TYPES` registry start | 2098 |
| `TYPES.MIDIOUT` entry | 2338–2362 |
| `ModuleMidiOut` component | 3087–3101 |
| `COMPONENT_FOR` map | 3103–3114 |
| App `data()` | 3158 |
| `addModule` (CLOCK guard) | 3242–3251 |
| `emit()` | 3443 |
| `panic()` | 3650–3665 |
| `saveStandalone` | 3986 |
| mounted: boot-load + `__SEQ` | 4247–4267 |

All insertions are additive; line numbers drift downward as tasks land — match on content, not absolute line.

---

### Task 1: Build script + vendored bundle

**Files:**
- Create: `tools/build-viktor-bundle.sh`
- Output artifact: `$SCRATCH/viktor-nv1.bundle.min.js` (NOT committed; it lives only inside index.html)

**Interfaces:**
- Produces: `$SCRATCH/viktor-nv1.bundle.min.js` defining global `NV1` with `{ DAW, Synth, PatchLibrary, create, defaultPatches }`. Task 2 pastes it into index.html.

- [ ] **Step 1: Verify Chrome exists (fail fast for later tasks)**

Run: `test -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" && echo OK`
Expected: `OK` (if not, stop; report to user)

- [ ] **Step 2: Write the build script**

```bash
#!/usr/bin/env bash
# Regenerates the vendored Viktor NV-1 engine bundle embedded in index.html
# (the <script> block that defines the NV1 global).
#
# Usage: tools/build-viktor-bundle.sh [outfile]   (default: ./viktor-nv1.bundle.min.js)
#
# Four build-time patches vs upstream — all I/O plumbing, zero DSP changes:
#   1. const.js — blank the reverb impulse path; the app synthesizes the
#      impulse at runtime instead of shipping/fetching a 552 KB WAV.
#   2. tuna.js  — blank the Convolver's fallback impulse path (a blank
#      properties.impulse would otherwise fall through || to an XHR).
#   3. daw.js   — drop midiController.init(); Viktor must not attach to live
#      WebMIDI inputs (1-byte MIDI clock messages make its parser throw, and
#      MIDI-in -> Viktor is out of scope).
#   4. entry    — re-export defaultPatches (NV1.defaultPatches) so the UI can
#      list patch names before any AudioContext exists (pre-gesture).
set -euo pipefail

PIN_COMMIT=50b2c5a80f347e00152daa3771cb83e5ba812feb   # viktor-nv1-engine v2.0.1
REPO=https://github.com/nicroto/viktor-nv1-engine

OUT=$(cd "$(dirname "${1:-viktor-nv1.bundle.min.js}")" && pwd)/$(basename "${1:-viktor-nv1.bundle.min.js}")
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

git clone -q "$REPO" "$WORK/engine"
git -C "$WORK/engine" checkout -q "$PIN_COMMIT"
cd "$WORK/engine"
npm install --omit=dev --silent

# patch 1: no impulse WAV request
perl -pi -e 's{impulse: "impulses/impulse_rev\.wav"}{impulse: ""}' src/daw/engine/const.js
grep -q 'impulse: ""' src/daw/engine/const.js

# patch 2: no fallback impulse XHR
perl -pi -e 's{properties\.impulse \|\| "\.\./impulses/ir_rev_short\.wav"}{properties.impulse || ""}' src/daw/non-npm/tuna/tuna.js
if grep -q 'ir_rev_short' src/daw/non-npm/tuna/tuna.js; then echo "FAIL: tuna fallback impulse not blanked" >&2; exit 1; fi

# patch 3: never attach to live MIDI inputs
perl -ni -e 'print unless /^\s*midiController\.init\(\);\s*$/' src/daw/daw.js
if grep -q 'midiController.init()' src/daw/daw.js; then echo "FAIL: midiController.init() still present" >&2; exit 1; fi

# patch 4: expose the factory patch bank statically
cat > nv1-entry.js <<'EOF'
'use strict';
var api = require('./src/index.js');
module.exports = {
  DAW: api.DAW,
  Synth: api.Synth,
  PatchLibrary: api.PatchLibrary,
  create: api.create,
  defaultPatches: require('./src/patches/defaults'),
};
EOF

npx -y esbuild@0.28.1 nv1-entry.js --bundle --minify --format=iife \
  --global-name=NV1 --outfile=bundle.js >&2

# inline-embed safety: these sequences would terminate the <script> block early
if grep -q '</script' bundle.js; then echo "FAIL: bundle contains </script" >&2; exit 1; fi
if grep -q '<!--' bundle.js; then echo "FAIL: bundle contains <!--" >&2; exit 1; fi
grep -q 'var NV1=' bundle.js

cp bundle.js "$OUT"
echo "wrote $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes, upstream $PIN_COMMIT)" >&2
```

- [ ] **Step 3: Make executable and run it**

Run:
```bash
chmod +x tools/build-viktor-bundle.sh
tools/build-viktor-bundle.sh "$SCRATCH/viktor-nv1.bundle.min.js"
```
Expected: `wrote .../viktor-nv1.bundle.min.js (~185000 bytes, upstream 50b2c5a...)` — slightly larger than 181,095 because of the defaultPatches re-export; anything in 180–200 KB is fine.

- [ ] **Step 4: Sanity-check the bundle in node**

Run:
```bash
node -e "
const fs = require('fs');
eval(fs.readFileSync('$SCRATCH/viktor-nv1.bundle.min.js', 'utf8'));
const names = Object.keys(NV1.defaultPatches);
console.log(typeof NV1.create, names.length, names.includes('Electric Piano'));
"
```
Expected: `function 64 true`

- [ ] **Step 5: Commit**

```bash
git add tools/build-viktor-bundle.sh
git commit -m "Add Viktor NV-1 bundle build script"
```

---

### Task 2: Embed the bundle in index.html

**Files:**
- Modify: `index.html` — head attribution comment (~line 5) + new `<script>` block after the Vue runtime's closing `</script>` (after line 1928's blob)

**Interfaces:**
- Produces: global `NV1` available to the main app script. All later tasks assume it.

- [ ] **Step 1: Locate the insertion point**

Run: `awk 'NR>=1928 && NR<=1935 {print NR": "substr($0,1,60)}' index.html`
Find the `</script>` that closes the Vue runtime block. The NV1 block goes immediately after it, before the main app `<script>` opens.

- [ ] **Step 2: Insert the bundle block (via a small script — the bundle is one 185 KB line; don't paste it through an editor tool)**

Write `$SCRATCH/embed-bundle.py`:

```python
#!/usr/bin/env python3
import sys

idx_path, bundle_path = sys.argv[1], sys.argv[2]
html = open(idx_path, encoding="utf-8").read()
bundle = open(bundle_path, encoding="utf-8").read().strip()

assert "var NV1=" not in html, "bundle already embedded"

header = """    <script>
      /* viktor-nv1-engine v2.0.1 — github.com/nicroto/viktor-nv1-engine
         @ 50b2c5a80f347e00152daa3771cb83e5ba812feb — MIT, (c) Nikolay Tsenkov.
         Includes Tuna audio effects (MIT). Vendored minified bundle: regenerate
         with tools/build-viktor-bundle.sh, do NOT edit by hand. Differs from
         upstream by 4 build patches (I/O only, no DSP): reverb impulse path
         blanked (impulse is synthesized at runtime — no WAV, no XHR), tuna
         fallback impulse blanked, midiController.init() removed (no live
         MIDI-in attach), NV1.defaultPatches exported. */
"""
footer = "\n    </script>\n"

# insert right after the Vue runtime's closing </script> (first one in <body>)
marker = html.index("</script>", html.index("<body>")) + len("</script>")
html = html[:marker] + "\n" + header + bundle + footer + html[marker:]
open(idx_path, "w", encoding="utf-8").write(html)
print("embedded", len(bundle), "bytes")
```

Run: `python3 $SCRATCH/embed-bundle.py index.html $SCRATCH/viktor-nv1.bundle.min.js`
Expected: `embedded ~185000 bytes`

CAUTION: verify the first `</script>` after `<body>` really is the Vue runtime's (step 1) — if any earlier inline script exists in body, adjust the marker search to anchor on the blob line instead.

- [ ] **Step 3: Add head attribution**

Read the attribution comment at the top of `<head>` (~line 5) and append, matching its existing format, a notice:
`viktor-nv1-engine (MIT, (c) Nikolay Tsenkov) + Tuna effects (MIT) — embedded synth engine`

- [ ] **Step 4: Verify the page still boots clean**

Run:
```bash
rm -rf "$SCRATCH/chrome-profile"
timeout 20 "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --enable-logging=stderr \
  --user-data-dir="$SCRATCH/chrome-profile" \
  --dump-dom "file://$PWD/index.html" > "$SCRATCH/dom.html" 2> "$SCRATCH/boot.log" || true
grep -ci "uncaught\|syntaxerror" "$SCRATCH/boot.log" || echo CLEAN
grep -c 'id="topbar"' "$SCRATCH/dom.html"
```
Expected: `CLEAN` (or `0`) and `1` — no console errors, app rendered.

- [ ] **Step 5: Check size budget**

Run: `wc -c index.html`
Expected: ~1,107,000 bytes (921,790 + ~185 KB). Abort and investigate if > 1,120,000.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Embed viktor-nv1-engine bundle (NV1 global)"
```

---

### Task 3: Engine shim + VIKTOR registry entry + smoke harness

**Files:**
- Modify: `index.html` —
  - shim functions: insert in the HELPERS section, right after `secondsPerPulse()` (~line 2007)
  - `TYPES.VIKTOR`: after the `MIDIOUT` entry (~line 2362, before the registry's closing `};`)
  - `PALETTE`: add `'VIKTOR'` after `'MIDIOUT'` (~line 1990)
  - `addModule` guard (~line 3245)
  - `panic()` (~line 3664)
- Create: `$SCRATCH/viktor-smoke.html`, `$SCRATCH/run-smoke.sh` (harness, not committed)

**Interfaces:**
- Consumes: `NV1` global (Task 2), existing `clamp()`, `nowSec()`.
- Produces (script-scope, used by Tasks 4–6): `viktorEnsure() -> rt|null` where `rt = { engine, ctx, volumeNode, timers:Set, sounding:Map, loadedPatch:string }`; `viktorNames() -> string[]`; `viktorSetPatch(name)`; `viktorSetVolume(v01)`; `viktorNote(ev)`; `viktorPanic()`; `VIKTOR_DEFAULT_PATCH_NAME = 'Electric Piano'`; debug handle `window.__VIKTOR = () => viktorRt`.

- [ ] **Step 1: Write the failing smoke harness**

`$SCRATCH/viktor-smoke.html`:

```html
<!DOCTYPE html>
<meta charset="utf-8">
<title>viktor smoke</title>
<iframe id="f" src="/index.html" style="width:1280px;height:900px"></iframe>
<script>
  const log = (m) => console.log('SMOKE:' + m);
  const fail = (m) => log('FAIL ' + m);
  window.onerror = (m) => fail('harness-error ' + m);
  document.getElementById('f').onload = async () => {
    const W = document.getElementById('f').contentWindow;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    try {
      await sleep(400); // let the app mount
      const app = W.__SEQ;
      if (!app) return fail('no __SEQ');
      if (typeof W.NV1?.create !== 'function') return fail('no NV1');
      if (Object.keys(W.NV1.defaultPatches).length !== 64) return fail('patch count');

      const m = app.addModule('VIKTOR', 100, 100);
      if (!m || m.type !== 'VIKTOR') return fail('addModule');
      if (m.params.patchName !== 'Electric Piano') return fail('default patch');
      if (app.addModule('VIKTOR', 300, 300) !== m) return fail('single-instance guard');

      // cable a fake source and push a note through the registry path
      const src = app.addModule('STEP', 400, 100);
      app.cables.push({ from: { mid: src.id, port: 'note' }, to: { mid: m.id, port: 'in' }, type: 'note' });
      const now = W.performance.now() / 1000;
      app.emit(src, 'note', { kind: 'note', time: now + 0.02, pitch: 60, vel: 100, gateLen: 0.6 });

      await sleep(250); // note-on fired (20ms) + envelope attack
      const v = W.__VIKTOR();
      if (!v) return fail('engine not created');
      if (v.ctx.state !== 'running') return fail('ctx ' + v.ctx.state);
      if (!(v.engine.reverb.convolver.buffer?.length > 0)) return fail('no impulse');
      if (v.loadedPatch !== 'Electric Piano') return fail('patch not loaded');

      const an = v.ctx.createAnalyser();
      v.volumeNode.connect(an);
      const buf = new Float32Array(an.fftSize);
      let peak = 0;
      for (let i = 0; i < 20; i++) {
        an.getFloatTimeDomainData(buf);
        for (const s of buf) peak = Math.max(peak, Math.abs(s));
        await sleep(25);
      }
      if (!(peak > 0.001)) return fail('silent output, peak=' + peak);

      await sleep(600); // note-off at 620ms; sounding map must drain
      if (v.sounding.size !== 0) return fail('sounding not drained');

      // export-app integrity: serialized doc still carries the engine + patch
      const html = W.document.documentElement.outerHTML;
      if (!html.includes('var NV1=')) return fail('bundle lost in outerHTML');

      log('PASS peak=' + peak.toFixed(4));
    } catch (e) {
      fail('exception ' + (e && e.message));
    }
  };
</script>
```

`$SCRATCH/run-smoke.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
SCRATCH="$(cd "$(dirname "$0")" && pwd)"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
ln -sf /Users/tmoney/code/vibes/lambda-sequencer/index.html "$SCRATCH/index.html"
cd "$SCRATCH"
python3 -m http.server 8437 --bind 127.0.0.1 >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
sleep 0.7
rm -rf "$SCRATCH/chrome-smoke-profile"
timeout 30 "$CHROME" --headless=new --disable-gpu \
  --autoplay-policy=no-user-gesture-required \
  --enable-logging=stderr --user-data-dir="$SCRATCH/chrome-smoke-profile" \
  "http://127.0.0.1:8437/viktor-smoke.html" 2>&1 | grep -m1 -o 'SMOKE:.*' || echo 'SMOKE:FAIL no output'
```

Note: the harness drives real audio — `--autoplay-policy=no-user-gesture-required` stands in for the user gesture that real usage provides. Do NOT use `--virtual-time-budget` (it starves the audio clock).

- [ ] **Step 2: Run it, verify it fails for the right reason**

Run: `chmod +x $SCRATCH/run-smoke.sh && $SCRATCH/run-smoke.sh`
Expected: `SMOKE:FAIL addModule` (TYPES.VIKTOR doesn't exist yet; `addModule` returns null)

- [ ] **Step 3: Implement the shim**

Insert after `secondsPerPulse()` in HELPERS (all functions are script-scope, same closure as the app):

```js
      // =============================================================
      // VIKTOR NV-1 — embedded synth engine shim
      // (bundle: NV1 <script> block above; timing analysis: learnings.md)
      // =============================================================
      const VIKTOR_DEFAULT_PATCH_NAME = 'Electric Piano';
      // the engine's PatchLibrary wants a persistence store; module params are
      // the single source of truth here, so hand it a black hole
      const VIKTOR_NULL_STORE = { get: () => null, set() {}, remove() {} };
      let viktorRt = null;
      let viktorFailed = false;

      // 2.2s stereo exponentially-decaying noise at the context's sample rate,
      // seeded xorshift so every load sounds identical — replaces the 552 KB
      // impulse WAV we don't ship
      function viktorImpulse(ctx) {
        const rate = ctx.sampleRate,
          len = Math.floor(2.2 * rate),
          buf = ctx.createBuffer(2, len, rate);
        let seed = 0x2f6e2b1;
        for (let ch = 0; ch < 2; ch++) {
          const d = buf.getChannelData(ch);
          for (let i = 0; i < len; i++) {
            seed ^= seed << 13;
            seed ^= seed >>> 17;
            seed ^= seed << 5;
            d[i] = ((seed >>> 0) / 0x80000000 - 1) * Math.pow(1 - i / len, 4.5);
          }
        }
        return buf;
      }

      // lazy + idempotent; must first run inside a user gesture (autoplay policy)
      function viktorEnsure() {
        if (viktorRt || viktorFailed) return viktorRt;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC || !window.NV1) {
          viktorFailed = true;
          return null;
        }
        try {
          const engine = NV1.create(AC, VIKTOR_NULL_STORE).dawEngine;
          const ctx = engine.audioContext;
          // splice our volume gain between the engine's master out and the
          // speakers — patches overwrite engine.masterVolume on load
          engine.masterVolume.disconnect();
          const volumeNode = ctx.createGain();
          engine.masterVolume.connect(volumeNode);
          volumeNode.connect(ctx.destination);
          engine.reverb.convolver.buffer = viktorImpulse(ctx);
          viktorRt = {
            engine,
            ctx,
            volumeNode,
            timers: new Set(),
            sounding: new Map(),
            loadedPatch: '',
          };
        } catch (e) {
          console.warn('Viktor init failed:', e);
          viktorFailed = true;
        }
        return viktorRt;
      }

      function viktorNames() {
        return window.NV1 ? Object.keys(NV1.defaultPatches) : [];
      }

      function viktorSetPatch(name) {
        const v = viktorEnsure();
        if (!v || v.loadedPatch === name) return;
        const src =
          NV1.defaultPatches[name] ||
          NV1.defaultPatches[VIKTOR_DEFAULT_PATCH_NAME];
        // deep-clone: loadPatch/settings-convertor transposes values in place
        v.engine.loadPatch(JSON.parse(JSON.stringify(src)), true);
        v.loadedPatch = name;
      }

      function viktorSetVolume(vol) {
        const v = viktorEnsure();
        if (v) v.volumeNode.gain.value = clamp(+vol || 0, 0, 1);
      }

      // hold each event on a timer until its due time — the engine's MIDI path
      // plays immediately; forwarding on arrival would quantize the note grid
      // to the 25ms scheduler wakeups (see learnings.md)
      function viktorNote(ev) {
        const v = viktorEnsure();
        if (!v) return;
        if (v.ctx.state === 'suspended') {
          try {
            v.ctx.resume();
          } catch {}
        }
        const pitch = clamp(ev.pitch | 0, 0, 127),
          vel = clamp(ev.vel | 0, 1, 127),
          delay = Math.max(0, (ev.time - nowSec()) * 1000),
          gate = clamp(ev.gateLen || 0.1, 0.01, 4) * 1000;
        const tOn = setTimeout(() => {
          v.timers.delete(tOn);
          v.engine.externalMidiMessage({ data: [0x90, pitch, vel] });
          v.sounding.set(pitch, (v.sounding.get(pitch) || 0) + 1);
        }, delay);
        v.timers.add(tOn);
        const tOff = setTimeout(() => {
          v.timers.delete(tOff);
          const n = (v.sounding.get(pitch) || 1) - 1;
          if (n > 0) v.sounding.set(pitch, n);
          else {
            v.sounding.delete(pitch);
            // last release for this pitch — only now free the engine voice
            v.engine.externalMidiMessage({ data: [0x80, pitch, 0] });
          }
        }, delay + gate);
        v.timers.add(tOff);
      }

      function viktorPanic() {
        const v = viktorRt;
        if (!v) return;
        for (const t of v.timers) clearTimeout(t);
        v.timers.clear();
        for (const pitch of v.sounding.keys())
          v.engine.externalMidiMessage({ data: [0x80, pitch, 0] });
        v.sounding.clear();
      }

      // debug handle (same idiom as window.__SEQ)
      window.__VIKTOR = () => viktorRt;
```

- [ ] **Step 4: Registry entry, palette, guard, panic hook**

`TYPES` — after the MIDIOUT entry's closing `},`:

```js
        VIKTOR: {
          inputs: [{ name: 'in', type: 'note' }],
          outputs: [],
          defaults: () => ({
            patchName: VIKTOR_DEFAULT_PATCH_NAME,
            volume: 0.8,
          }),
          onInput(ctx, m, port, ev) {
            if (port !== 'in' || ev.kind !== 'note') return;
            if (!viktorEnsure()) {
              // reactive once Task 5 declares viktorError in data(); a plain
              // (harmless) instance set before that
              ctx.viktorError = viktorFailed;
              return;
            }
            // idempotent re-asserts: cheap, and self-healing across init order
            viktorSetPatch(m.params.patchName);
            viktorSetVolume(m.params.volume);
            viktorNote(ev);
            m.state.activity = true;
            clearTimeout(m.state._actT);
            m.state._actT = setTimeout(() => {
              m.state.activity = false;
            }, 80);
          },
        },
```

`PALETTE` — add `'VIKTOR',` after `'MIDIOUT',`.

`addModule` — replace the CLOCK-only guard:

```js
            if (type === 'CLOCK' || type === 'VIKTOR') {
              const existing = this.modules.find((m) => m.type === type);
              if (existing) {
                this.setStatus('only one ' + type + ' module', true);
                return existing;
              }
            }
```

`panic()` — before `this.activeNotes.length = 0;` add:

```js
            viktorPanic();
```

- [ ] **Step 5: Run the harness to green**

Run: `$SCRATCH/run-smoke.sh`
Expected: `SMOKE:PASS peak=0.0xxx`

NOTE: at this point VIKTOR has no Vue component — `componentFor('VIKTOR')` returns null and the module renders nothing on stage. The harness drives the registry directly so it passes; the component lands in Task 4. Expect a Vue warning in the boot log for the harness-added module only (no module in the default patch), not on plain boot.

- [ ] **Step 6: Plain boot still clean**

Re-run the Task 2 Step 4 boot check. Expected: `CLEAN`, topbar rendered.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "Add Viktor engine shim + VIKTOR module type"
```

---

### Task 4: VIKTOR rack module component

**Files:**
- Modify: `index.html` —
  - template: after `</template>` of tmpl-midiout (~line 1925)
  - component: after `ModuleMidiOut` (~line 3101)
  - `COMPONENT_FOR`: add entry (~line 3113)
  - App `provide()`: add `seqSetView` (~line 3127) — NOTE: `setView` itself lands in Task 5; provide a stub-tolerant closure now
  - CSS: generalize the activity dot + new patch-name style (~line 822)

**Interfaces:**
- Consumes: `ModuleFrame`, `baseProps`, `baseEmits`, TYPES.VIKTOR (Task 3).
- Produces: `ModuleViktor` component; injected `seqSetView(view)` (wired fully in Task 5).

- [ ] **Step 1: Add the template**

```html
    <template id="tmpl-viktor">
      <module-frame
        :module="module"
        title="VIKTOR"
        :inputs="[{name:'in',type:'note'}]"
        :outputs="[]"
        @head-pointerdown="$emit('head-pointerdown', $event)"
        @port-pointerdown="$emit('port-pointerdown', $event)"
        @port-dblclick="$emit('port-dblclick', $event)"
        @remove="$emit('remove')"
        @duplicate="$emit('duplicate')"
      >
        <div class="row">
          <label>PATCH</label>
          <span class="viktor-patch-name" :title="module.params.patchName">
            {{ module.params.patchName }}
          </span>
        </div>
        <div class="row">
          <button @click="seqSetView('viktor')">OPEN</button>
          <span :class="['activity', { on: module.state.activity }]"></span>
        </div>
        <template #help>
          Built-in <b>Viktor NV-1</b> synth — no MIDI device needed. Feed it
          notes, pick a <b>PATCH</b> on the synth page (<b>OPEN</b>, or the
          view switcher up top). Audio starts after your first click and runs
          fully offline. The dot blinks when notes are flowing.
        </template>
      </module-frame>
    </template>
```

- [ ] **Step 2: Add the component + registry**

After `ModuleMidiOut`:

```js
      const ModuleViktor = defineComponent({
        template: '#tmpl-viktor',
        components: { ModuleFrame },
        props: baseProps,
        emits: baseEmits,
        inject: { seqSetView: { default: () => () => {} } },
      });
```

`COMPONENT_FOR`: add `VIKTOR: ModuleViktor,` after `MIDIOUT: ModuleMidiOut,`.

App `provide()` — add after the `seqInDead` entry:

```js
            seqSetView: (v) => this.setView && this.setView(v),
```

- [ ] **Step 3: CSS**

Replace the two `.module.MIDIOUT .activity` selectors to cover both modules, and add the patch-name style:

```css
      .module.MIDIOUT .activity,
      .module.VIKTOR .activity {
        display: inline-block;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: var(--bg2);
        margin-left: 6px;
        transition: background 0.12s;
      }
      .module.MIDIOUT .activity.on,
      .module.VIKTOR .activity.on {
        background: var(--accent);
        box-shadow: 0 0 8px var(--accent);
      }
      .module.VIKTOR .viktor-patch-name {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--note);
      }
```

- [ ] **Step 4: Extend the harness with a DOM assertion**

In `$SCRATCH/viktor-smoke.html`, after the `single-instance guard` check, add:

```js
      await sleep(150); // let Vue render the module
      const modEl = [...W.document.querySelectorAll('#stage .module.VIKTOR')];
      if (modEl.length !== 1) return fail('VIKTOR module not rendered');
      if (!modEl[0].textContent.includes('Electric Piano')) return fail('patch name not shown');
```

- [ ] **Step 5: Run harness**

Run: `$SCRATCH/run-smoke.sh`
Expected: `SMOKE:PASS peak=0.0xxx`

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Add VIKTOR rack module component"
```

---

### Task 5: View switcher + Viktor synth pane

**Files:**
- Modify: `index.html` —
  - topbar markup after zoom-ctrl (~line 1041)
  - tmpl-app root div class binding (~line 1025) + `#stage`/`#palette` v-show + pane element after `#stage` close (~line 1108)
  - new `tmpl-viktor-panel` template after tmpl-viktor
  - `VIEW_KEY` const next to `SAVE_KEY` (~line 1992)
  - `ViktorPanel` component after `ModuleViktor`; App `components`, `data`, `computed`, `methods`, `mounted`
  - CSS: view-switch buttons + pane layout

**Interfaces:**
- Consumes: shim fns (Task 3), `ModuleViktor` (Task 4), `addAtCenter`.
- Produces: `App.setView(v)` with `v ∈ 'rack'|'viktor'|'both'` (satisfies Task 4's `seqSetView`); `App.viktorModule` computed; `ViktorPanel` component.

- [ ] **Step 1: Template changes**

tmpl-app root (line 1025): `<div>` → `<div :class="'view-' + view">`

Topbar, after the zoom-ctrl `</div>`:

```html
          <div class="sep"></div>
          <div class="view-switch">
            <button :class="{ on: view === 'rack' }" @click="setView('rack')">RACK</button>
            <button :class="{ on: view === 'both' }" @click="setView('both')">BOTH</button>
            <button :class="{ on: view === 'viktor' }" @click="setView('viktor')">VIKTOR</button>
          </div>
```

After `#stage`'s closing `</div>` (line ~1108), insert:

```html
        <!-- VIKTOR SYNTH PANE -->
        <viktor-panel
          v-show="view !== 'rack'"
          :module="viktorModule"
          :patch-names="viktorPatchNames"
          :error="viktorError"
          @add="addAtCenter('VIKTOR')"
          @change="viktorParamsChanged"
        ></viktor-panel>
```

`#palette` (line ~1111): add `v-show="view !== 'viktor'"`.
(#stage visibility is handled purely in CSS via `.view-viktor #stage` — keep the element mounted so cable geometry survives.)

New template after tmpl-viktor:

```html
    <template id="tmpl-viktor-panel">
      <div id="viktor-pane">
        <div v-if="error" class="viktor-empty">
          <p>Viktor engine unavailable in this browser (WebAudio required).</p>
        </div>
        <div v-else-if="!module" class="viktor-empty">
          <p>No VIKTOR module in the rack.</p>
          <button @click="$emit('add')">+ ADD VIKTOR</button>
        </div>
        <div v-else class="viktor-panel">
          <div class="viktor-head">VIKTOR NV-1</div>
          <div class="viktor-patch-big">{{ module.params.patchName }}</div>
          <div class="row">
            <button @click="step(-1)">‹ PREV</button>
            <select v-model="module.params.patchName" @change="$emit('change')">
              <option v-for="n in patchNames" :key="n" :value="n">{{ n }}</option>
            </select>
            <button @click="step(1)">NEXT ›</button>
          </div>
          <div class="row">
            <label>VOLUME</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              v-model.number="module.params.volume"
              @input="$emit('change')"
            />
            <span class="viktor-vol-pct">{{ Math.round(module.params.volume * 100) }}%</span>
          </div>
          <p class="viktor-note">
            64 factory patches. Sound-shaping knobs land in a later phase.
          </p>
        </div>
      </div>
    </template>
```

- [ ] **Step 2: Script changes**

Next to `SAVE_KEY`:

```js
      const VIEW_KEY = 'lambda-seq-view:' + location.pathname;
```

Component after `ModuleViktor`:

```js
      const ViktorPanel = defineComponent({
        template: '#tmpl-viktor-panel',
        props: {
          module: { type: Object, default: null },
          patchNames: { type: Array, default: () => [] },
          error: { type: Boolean, default: false },
        },
        emits: ['add', 'change'],
        methods: {
          step(d) {
            const names = this.patchNames;
            if (!names.length || !this.module) return;
            const i = names.indexOf(this.module.params.patchName);
            this.module.params.patchName =
              names[(i + d + names.length) % names.length];
            this.$emit('change');
          },
        },
      });
```

App `components`: `components: { ModuleFrame, ViktorPanel, ...COMPONENT_FOR },`

App `data()`: add `view: 'rack',` and `viktorError: false,` (anywhere top-level in the returned object).

App `computed`:

```js
          viktorModule() {
            return this.modules.find((m) => m.type === 'VIKTOR') || null;
          },
          viktorPatchNames() {
            return viktorNames();
          },
```

App `methods` (near setStatus):

```js
          setView(v) {
            if (!['rack', 'viktor', 'both'].includes(v)) v = 'rack';
            this.view = v;
            try {
              localStorage.setItem(VIEW_KEY, v);
            } catch {}
            // stage geometry changes (width / display) — re-measure jacks
            nextTick(() => {
              this.rerouteVersion++;
            });
          },

          // panel edits: apply live if the engine exists (or can start now —
          // this runs inside a click/input gesture), then persist
          viktorParamsChanged() {
            const m = this.viktorModule;
            if (m && viktorEnsure()) {
              viktorSetPatch(m.params.patchName);
              viktorSetVolume(m.params.volume);
            }
            this.viktorError = viktorFailed;
            this.save();
          },
```

App `mounted` — before the boot-load block:

```js
          try {
            this.setView(localStorage.getItem(VIEW_KEY) || 'rack');
          } catch {}
```

- [ ] **Step 3: CSS (place after the `#palette` rules)**

```css
      /* ----- view switcher + viktor pane ----- */
      #topbar .view-switch {
        display: flex;
        gap: 2px;
      }
      #topbar .view-switch button.on {
        background: var(--panel-hi);
        color: var(--accent);
        border-color: var(--accent);
      }
      #viktor-pane {
        position: absolute;
        top: 44px;
        bottom: 0;
        right: 0;
        left: 60%;
        overflow: auto;
        background: var(--bg2);
        border-left: 1px solid var(--line);
      }
      .view-rack #viktor-pane {
        display: none;
      }
      .view-viktor #viktor-pane {
        left: 0;
        border-left: none;
      }
      .view-viktor #stage,
      .view-viktor #palette {
        display: none;
      }
      .view-both #stage {
        right: 40%;
      }
      #viktor-pane .viktor-empty {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        height: 100%;
        gap: 12px;
        color: var(--dim);
      }
      #viktor-pane .viktor-panel {
        max-width: 560px;
        margin: 0 auto;
        padding: 32px 24px;
        display: flex;
        flex-direction: column;
        gap: 16px;
      }
      #viktor-pane .viktor-head {
        color: var(--dim);
        letter-spacing: 2px;
      }
      #viktor-pane .viktor-patch-big {
        font-size: 22px;
        color: var(--note);
        min-height: 30px;
      }
      #viktor-pane .row {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #viktor-pane select {
        flex: 1;
        min-width: 0;
      }
      #viktor-pane input[type='range'] {
        flex: 1;
        accent-color: var(--accent);
      }
      #viktor-pane button,
      #viktor-pane select {
        background: var(--panel);
        color: var(--text);
        border: 1px solid var(--line);
        border-radius: 4px;
        padding: 4px 10px;
        font: inherit;
        cursor: pointer;
      }
      #viktor-pane button:hover {
        background: var(--panel-hi);
      }
      #viktor-pane .viktor-note {
        color: var(--dim);
      }
      #viktor-pane .viktor-vol-pct {
        color: var(--dim);
        min-width: 4ch;
        text-align: right;
      }
```

- [ ] **Step 4: Extend harness for views**

Add to `$SCRATCH/viktor-smoke.html` after the patch-name DOM check:

```js
      // view switcher
      app.setView('both');
      await sleep(150);
      const pane = W.document.querySelector('#viktor-pane');
      if (!pane || pane.offsetParent === null) return fail('pane hidden in BOTH');
      if (!pane.textContent.includes('Electric Piano')) return fail('pane patch name');
      if (W.document.querySelectorAll('#viktor-pane select option').length !== 64)
        return fail('dropdown patch count');
      app.setView('viktor');
      await sleep(100);
      if (W.document.querySelector('#stage').offsetParent !== null)
        return fail('stage visible in VIKTOR view');
      app.setView('rack');
      await sleep(100);
      if (pane.offsetParent !== null) return fail('pane visible in RACK view');
      if (W.localStorage.getItem('lambda-seq-view:/index.html') !== 'rack')
        return fail('view not persisted');
```

- [ ] **Step 5: Run harness**

Run: `$SCRATCH/run-smoke.sh`
Expected: `SMOKE:PASS peak=0.0xxx`

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Add RACK/BOTH/VIKTOR view switcher and synth pane"
```

---

### Task 6: Boot-time init arming, docs, final verification

**Files:**
- Modify: `index.html` (mounted hook), `README.md`, `SCHEMA.md`
- Modify: `docs/superpowers/specs/2026-07-01-viktor-embed-design.md` (mark implemented)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Arm one-time gesture init in mounted (after the boot-load `else this.bootDefault();` block)**

```js
          // Viktor can only start on a user gesture (autoplay policy); if the
          // boot patch already contains a VIKTOR module, arm a one-time init.
          // viktorEnsure() is idempotent so double-arming is harmless.
          if (this.viktorModule) {
            const arm = () => {
              const m = this.viktorModule;
              if (m && viktorEnsure()) {
                viktorSetPatch(m.params.patchName);
                viktorSetVolume(m.params.volume);
              }
            };
            window.addEventListener('pointerdown', arm, {
              once: true,
              capture: true,
            });
            window.addEventListener('keydown', arm, {
              once: true,
              capture: true,
            });
          }
```

- [ ] **Step 2: Harness — boot-patch arming test**

Add at the end of the harness checks (before `log('PASS...')`):

```js
      // reload with a VIKTOR-bearing patch in localStorage: engine must NOT
      // exist pre-gesture, and must start on the first pointerdown
      W.localStorage.setItem(
        'lambda-seq-v1:/index.html',
        JSON.stringify(app.serialize()),
      );
      const f2 = document.createElement('iframe');
      f2.src = '/index.html';
      f2.style.cssText = 'width:1280px;height:900px';
      document.body.appendChild(f2);
      await new Promise((r) => (f2.onload = r));
      await sleep(500);
      const W2 = f2.contentWindow;
      if (!W2.__SEQ.viktorModule) return fail('boot patch lost VIKTOR');
      if (W2.__VIKTOR()) return fail('engine created without gesture');
      W2.document.body.dispatchEvent(
        new W2.PointerEvent('pointerdown', { bubbles: true }),
      );
      await sleep(300);
      if (!W2.__VIKTOR()) return fail('gesture arming did not init engine');
      if (W2.__VIKTOR().loadedPatch !== 'Electric Piano')
        return fail('armed init did not load patch');
```

Run: `$SCRATCH/run-smoke.sh` → must FAIL with `engine created without gesture`? No — expected first run: `SMOKE:FAIL gesture arming did not init engine` (arming code not yet present when you write the test first). Then add Step 1's code and re-run.
Expected after implementation: `SMOKE:PASS peak=0.0xxx`

- [ ] **Step 3: README section (after the "EXPORT APP" section)**

```markdown
## Built-in synth (Viktor NV-1)

λ-SEQ embeds the [Viktor NV-1](https://github.com/nicroto/viktor-nv1-engine)
synth engine (MIT), so patches can make sound with no MIDI device at all. Add a
**VIKTOR** module and cable notes into it like a MIDI OUT. The top bar's
**RACK | BOTH | VIKTOR** switcher shows the rack, the synth page (64 factory
patches + volume), or both side by side.

Everything runs offline inside the single HTML file — the engine is inlined and
the reverb impulse is synthesized at load, so no network is ever touched. Audio
starts after your first click (browser autoplay policy). Note timing for the
built-in synth rides the JS main thread (a few ms of jitter), unlike hardware
MIDI out which is scheduled by the OS — see `learnings.md` for the analysis.

The vendored engine bundle is regenerated with `tools/build-viktor-bundle.sh`
(pins the upstream commit; documents the four build-time patches).
```

- [ ] **Step 4: SCHEMA.md — add after the MIDIOUT section**

```markdown
### VIKTOR  (built-in Viktor NV-1 synth; max one)
- **inputs:** `in` (note) · **outputs:** none
- Plays notes on the embedded [Viktor NV-1](https://github.com/nicroto/viktor-nv1-engine)
  engine — no MIDI device needed. Audio starts after the first user gesture
  (browser autoplay policy).
- **params:**
  | key         | type   | default            | notes |
  |-------------|--------|--------------------|-------|
  | `patchName` | string | `"Electric Piano"` | Factory patch name (64 available). Unknown names fall back to the default. |
  | `volume`    | number | `0.8`              | Output gain 0–1, applied after the engine's own master volume. |
```

Also update the module `type` list note ("One of the module types below") — no change needed beyond the new section itself.

- [ ] **Step 5: Mark spec implemented**

In the spec header: `**Status:** approved` → `**Status:** implemented (2026-07-01)`.

- [ ] **Step 6: Full verification sweep**

```bash
# 1. harness (all assertions incl. audio, views, gesture arming, export integrity)
$SCRATCH/run-smoke.sh                      # expect SMOKE:PASS

# 2. plain boot, fresh profile, file:// — no console errors
rm -rf "$SCRATCH/chrome-profile"
timeout 20 "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --enable-logging=stderr \
  --user-data-dir="$SCRATCH/chrome-profile" \
  --dump-dom "file://$PWD/index.html" > "$SCRATCH/dom.html" 2> "$SCRATCH/boot.log" || true
grep -ci "uncaught\|syntaxerror" "$SCRATCH/boot.log" || echo CLEAN   # expect CLEAN
grep -c 'view-switch' "$SCRATCH/dom.html"                            # expect >= 1

# 3. size budget
wc -c index.html    # expect <= 1,120,000

# 4. no accidental network references
grep -c 'impulses/' index.html   # expect 0 hits outside the NV1 bundle comment… verify any hit is inert (string in bundle is fine ONLY if it's the blanked-path code; investigate any URL-looking hit)
```

- [ ] **Step 7: Commit docs + final state**

```bash
git add index.html README.md SCHEMA.md docs/superpowers/specs/2026-07-01-viktor-embed-design.md docs/superpowers/plans/2026-07-01-viktor-embed.md learnings.md
git commit -m "Viktor NV-1 embed: boot arming, docs, verification"
```

---

## Post-plan notes for the executor

- The post-commit hook amends each commit to stamp the header hash — `git log` hashes shift by one; normal here.
- If `--headless=new` audio is silent on this Chrome build (peak=0 with everything else passing), retry with `--headless=old` before touching shim code; if still silent, verify with the user in a real browser rather than weakening the assertion.
- `duplicateModule` on VIKTOR hits the single-instance guard and returns the existing module — acceptable (status line explains).
- Arp-enabled factory patches (e.g. "Venga Party") arpeggiate at the *patch's* stored tempo, not λ-SEQ's BPM — accepted in spec; syncing `engine.tempoSettings` to BPM is a listed future idea, not MVP.

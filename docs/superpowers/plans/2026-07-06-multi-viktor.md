# Multi-Viktor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Up to 4 VIKTOR modules in the rack, each an independent Viktor NV-1 engine instance (own patch + volume), all sounding simultaneously through one shared AudioContext and the existing safety limiter.

**Architecture:** The singleton shim (`viktorRt`) becomes a registry (`viktorRts: Map<moduleId, runtime>`) hanging off a shared `{ctx, limiter, impulse}` created once. `NV1.create` receives a constructor whose `new` returns the shared context (a JS constructor returning an object overrides `this` — upstream `daw.js` calls `new AudioContext()`). All shim functions take the module id. The synth pane stacks one panel per module.

**Tech Stack:** Single-file Vue 3 app (`index.html`, no build step). Verification = headless Chrome harness (repo idiom: null audio sink, drive `window.__SEQ` / `window.__VIKTOR` from a same-origin harness page).

**Spec:** `docs/superpowers/specs/2026-07-06-multi-viktor-design.md`

## Global Constraints

- Everything lives in `index.html` (~5000 lines; ONE file, watch your edits). Line numbers below are from commit `c6c43db` and drift as you edit — anchor on the quoted code, not the numbers.
- NEVER read `index.html` whole (a base64 Vue line is ~700k tokens). Use `sed -n 'A,Bp'` or Read with offset/limit below line 2121, and grep for anchors.
- Byte budget: `wc -c index.html` must stay ≤ 1,131,000 (baseline 1,127,687).
- The engine bundle and `tools/build-viktor-bundle.sh` are untouched.
- The repo post-commit hook amends every commit to stamp the header hash — expect `git log` hashes to differ from what you predicted; that is normal.
- Harness Chrome flags (all REQUIRED): `--headless=new --disable-gpu --autoplay-policy=no-user-gesture-required --disable-audio-output --enable-logging=stderr --user-data-dir=<fresh dir>`. Never `--virtual-time-budget` (starves the audio clock).
- Scratch dir `$S` = `/tmp/claude-1000/-home-tmoney-code-vibes-lambda-sequencer/741205ff-a548-4b7a-9aad-46764ec0ca1c/scratchpad` (exists; already contains `index.html` symlink to the repo copy).

---

### Task 1: Failing multi-Viktor harness

**Files:**
- Create: `$S/multi-viktor-harness.html`
- Create: `$S/run-multi-viktor.sh`

**Interfaces:**
- Consumes: `window.__SEQ` (root Vue app: `.startTransport()`, `.stopTransport()`, `.load(patch)`, `.addModule(type,x,y)`, `.removeModule(id)`, `.applyViktorParams()`, `.setView(v)`, `.modules`), `window.__VIKTOR` (will return the `viktorRts` Map after Task 2 — the harness is written against the NEW API and must FAIL now).
- Produces: `bash $S/run-multi-viktor.sh` printing `MVH T<n> PASS|FAIL ...` lines and a final `MVH DONE`; Tasks 2–4 run it as their gate.

- [ ] **Step 1: Write the harness page**

Write `$S/multi-viktor-harness.html` exactly:

```html
<!doctype html>
<html>
<body>
<iframe id="f" src="/index.html" width="1400" height="900"></iframe>
<script>
const results = [];
const t = (id, ok, detail) =>
  console.log('MVH ' + id + ' ' + (ok ? 'PASS' : 'FAIL') + ' ' + detail);
const done = () => console.log('MVH DONE');
window.onerror = (m) => { t('T0', false, 'window-error ' + m); done(); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const db = (x) => (x > 0 ? (20 * Math.log10(x)).toFixed(1) : '-inf');

const PATCH2 = {
  bpm: 240, source: 'internal',
  modules: [
    { id: 1, type: 'CLOCK', x: 20, y: 40,
      params: { mode: 'internal', bpm: 240 }, disabled: {} },
    { id: 2, type: 'STEP', x: 300, y: 40,
      params: { len: 4, vel: 120, gateLen: 0.5, steps: [
        { on: true, pitch: 60, vel: 120 }, { on: true, pitch: 64, vel: 120 },
        { on: true, pitch: 67, vel: 120 }, { on: true, pitch: 72, vel: 120 } ] },
      disabled: {} },
    { id: 3, type: 'VIKTOR', x: 600, y: 40,
      params: { patchName: 'Electric Piano', volume: 0.8 }, disabled: {} },
    { id: 4, type: 'VIKTOR', x: 600, y: 300,
      params: { patchName: 'Electric Clavessine', volume: 0.8 }, disabled: {} },
  ],
  cables: [
    { from: { mid: 1, port: '1/8' },  to: { mid: 2, port: 'clk' }, type: 'clock' },
    { from: { mid: 2, port: 'note' }, to: { mid: 3, port: 'in' },  type: 'note' },
    { from: { mid: 2, port: 'note' }, to: { mid: 4, port: 'in' },  type: 'note' },
  ],
};

function tap(ctx, node) {
  const sp = ctx.createScriptProcessor(4096, 2, 1);
  const o = { peak: 0 };
  sp.onaudioprocess = (e) => {
    for (let ch = 0; ch < e.inputBuffer.numberOfChannels; ch++) {
      const d = e.inputBuffer.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        const a = Math.abs(d[i]);
        if (a > o.peak) o.peak = a;
      }
    }
  };
  node.connect(sp);
  const sink = ctx.createGain();
  sink.gain.value = 0;
  sp.connect(sink);
  sink.connect(ctx.destination);
  o.reset = () => (o.peak = 0);
  return o;
}

async function main() {
  const f = document.getElementById('f');
  if (!f.contentWindow || !f.contentWindow.__SEQ) {
    await new Promise((r) => (f.onload = r));
  }
  const W = f.contentWindow;
  for (let i = 0; i < 100 && !W.__SEQ; i++) await sleep(100);
  if (!W.__SEQ) { t('T0', false, 'no __SEQ'); return done(); }
  const SEQ = W.__SEQ;

  // T1 — boot regression: default patch (one Viktor) still sounds
  SEQ.startTransport();
  let rts = null;
  for (let i = 0; i < 100; i++) {
    rts = W.__VIKTOR();
    if (rts && rts instanceof W.Map && rts.size >= 1) break;
    rts = null;
    await sleep(100);
  }
  if (!rts) {
    t('T1', false, '__VIKTOR() is not a Map with >=1 runtime (old singleton API?)');
    return done();
  }
  const bootRt = [...rts.values()][0];
  const bootTap = tap(bootRt.ctx, bootRt.volumeNode);
  await sleep(3000);
  t('T1', bootTap.peak > 0.001, 'boot demo peak=' + db(bootTap.peak) + 'dBFS');
  SEQ.stopTransport();
  await sleep(300);

  // load the 2-Viktor patch
  SEQ.load(JSON.parse(JSON.stringify(PATCH2)));
  SEQ.startTransport();
  for (let i = 0; i < 50 && W.__VIKTOR().size < 2; i++) await sleep(100);
  rts = W.__VIKTOR();

  // T2 — registry shape: 2 runtimes, distinct engines, one shared ctx
  const rt3 = rts.get(3), rt4 = rts.get(4);
  t('T2', !!rt3 && !!rt4 && rt3.engine !== rt4.engine && rt3.ctx === rt4.ctx &&
        rt3.sounding !== rt4.sounding,
    'size=' + rts.size + ' sharedCtx=' + (rt3 && rt4 && rt3.ctx === rt4.ctx));
  if (!rt3 || !rt4) return done();

  // T3 — both audible
  const tap3 = tap(rt3.ctx, rt3.volumeNode);
  const tap4 = tap(rt4.ctx, rt4.volumeNode);
  await sleep(4000);
  t('T3', tap3.peak > 0.001 && tap4.peak > 0.001,
    'vik3=' + db(tap3.peak) + 'dBFS vik4=' + db(tap4.peak) + 'dBFS');

  // T4 — volume isolation: zero vik4, only its tap goes quiet
  SEQ.modules.find((m) => m.id === 4).params.volume = 0;
  SEQ.applyViktorParams();
  await sleep(600); // ramp + ringing tail head start
  tap3.reset(); tap4.reset();
  await sleep(3000);
  t('T4', tap3.peak > 0.001 && tap4.peak < 0.02,
    'vik3=' + db(tap3.peak) + 'dBFS vik4=' + db(tap4.peak) + 'dBFS');

  // T5 — stop panics every runtime: no pending timers, nothing sounding
  SEQ.stopTransport();
  await sleep(300);
  t('T5', rt3.timers.size === 0 && rt4.timers.size === 0 &&
        rt3.sounding.size === 0 && rt4.sounding.size === 0,
    'timers=' + rt3.timers.size + '/' + rt4.timers.size +
    ' sounding=' + rt3.sounding.size + '/' + rt4.sounding.size);

  // T6 — deleting a module tears down exactly its runtime
  SEQ.startTransport();
  await sleep(500);
  SEQ.removeModule(4);
  await sleep(300);
  tap3.reset(); tap4.reset();
  await sleep(2500);
  t('T6', !W.__VIKTOR().has(4) && W.__VIKTOR().has(3) &&
        tap3.peak > 0.001 && tap4.peak === 0,
    'has4=' + W.__VIKTOR().has(4) + ' vik3=' + db(tap3.peak) +
    'dBFS vik4=' + db(tap4.peak) + 'dBFS');
  SEQ.stopTransport();

  // T7 — cap at 4: five adds on top of the surviving one -> exactly 4 total
  for (let i = 0; i < 5; i++) SEQ.addModule('VIKTOR', 60 + i * 30, 60);
  const nVik = SEQ.modules.filter((m) => m.type === 'VIKTOR').length;
  t('T7', nVik === 4, 'viktor count=' + nVik);

  // T8 — synth pane stacks one panel per module (Task 3; FAILs until then)
  SEQ.setView('viktor');
  await sleep(400);
  const doc = f.contentDocument;
  const panels = doc.querySelectorAll('#viktor-pane .viktor-panel').length;
  const anchored = !!doc.getElementById(
    'viktor-panel-' + SEQ.modules.find((m) => m.type === 'VIKTOR').id);
  t('T8', panels === 4 && anchored, 'panels=' + panels + ' anchored=' + anchored);

  done();
}
main().catch((e) => { t('T0', false, (e && e.stack) || e); done(); });
</script>
</body>
</html>
```

- [ ] **Step 2: Write the runner**

Write `$S/run-multi-viktor.sh` exactly:

```bash
#!/usr/bin/env bash
set -uo pipefail
S=/tmp/claude-1000/-home-tmoney-code-vibes-lambda-sequencer/741205ff-a548-4b7a-9aad-46764ec0ca1c/scratchpad
cd "$S"
ln -sf /home/tmoney/code/vibes/lambda-sequencer/index.html "$S/index.html"
python3 -m http.server 8437 --bind 127.0.0.1 >/dev/null 2>&1 &
SRV=$!
trap 'kill $SRV 2>/dev/null' EXIT
sleep 1
rm -rf "$S/mvh-profile"
timeout 60 google-chrome-stable --headless=new --disable-gpu \
  --autoplay-policy=no-user-gesture-required --disable-audio-output \
  --enable-logging=stderr --user-data-dir="$S/mvh-profile" \
  http://127.0.0.1:8437/multi-viktor-harness.html 2>&1 | grep -ao 'MVH .*'
BYTES=$(wc -c < /home/tmoney/code/vibes/lambda-sequencer/index.html)
echo "MVH BYTES $BYTES $([ "$BYTES" -le 1131000 ] && echo PASS || echo FAIL)"
```

- [ ] **Step 3: Run it — expect failure at T1**

Run: `bash $S/run-multi-viktor.sh`
Expected: `MVH T1 FAIL __VIKTOR() is not a Map with >=1 runtime (old singleton API?)` then `MVH DONE`, and `MVH BYTES <n> PASS`. (The current shim returns a singleton object, not a Map.) Do NOT commit scratch files; nothing in the repo changed.

---

### Task 2: Shim registry + routing + lifecycle (index.html)

**Files:**
- Modify: `index.html` — shim section (anchor: `// VIKTOR NV-1 — embedded synth engine shim`, lines ~2214–2366), `TYPES.VIKTOR.onInput` (anchor: `VIKTOR: {` inside `TYPES`, ~2724), `applyViktorParams` (~3825), `addModule` guard (~3852), `removeModule` (~3883), `load()` (~4614), boot arming (anchor: `boot patch already contains a VIKTOR module`, ~4961), computed block (anchor: `viktorModule()`, ~3790).

**Interfaces:**
- Consumes: existing `viktorImpulse(ctx)`, `VIKTOR_NULL_STORE`, `VIKTOR_MAKEUP`, `clamp`, `nowSec`.
- Produces (Tasks 3–4 rely on these exact names): `VIKTOR_MAX = 4`; `viktorEnsure(mid) -> rt|null`; `viktorSetPatch(mid, name)`; `viktorSetVolume(mid, vol01)`; `viktorNote(mid, ev)`; `viktorPanic()`; `viktorDispose(mid)`; `viktorDisposeAll()`; `viktorNames()` (unchanged); `window.__VIKTOR = () => viktorRts` (the Map); App computed `viktorModules` (array). `viktorModule` (singular) survives this task and dies in Task 3.

- [ ] **Step 1: Replace the singleton shim with the registry**

Replace the block from `let viktorRt = null;` through the end of `viktorPanic()` and the `window.__VIKTOR` line (keep `VIKTOR_DEFAULT_PATCH_NAME`, the `VIKTOR_NULL_STORE` comment+line, and `viktorImpulse` as they are; keep the `VIKTOR_MAKEUP` comment+const where it sits between setPatch and setVolume). New code:

```js
      const VIKTOR_MAX = 4;
      // one AudioContext + safety limiter shared by every VIKTOR module;
      // each module gets its own engine + volume gain in viktorRts
      let viktorShared = null;
      let viktorFailed = false;
      const viktorRts = new Map(); // module id -> runtime
```

(then `viktorImpulse` unchanged, then:)

```js
      // lazy + idempotent; must first run inside a user gesture (autoplay policy)
      function viktorSharedEnsure() {
        if (viktorShared || viktorFailed) return viktorShared;
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC || !window.NV1) {
          viktorFailed = true;
          return null;
        }
        let ctx = null;
        try {
          ctx = new AC();
          // engines mix ~-20 dBFS/note (headroom for their voice pools); the
          // per-module volume gain carries makeup (VIKTOR_MAKEUP) and this
          // shared limiter keeps stacked modules/voices off the rail
          const limiter = ctx.createDynamicsCompressor();
          limiter.threshold.value = -3;
          limiter.knee.value = 6;
          limiter.ratio.value = 20;
          limiter.attack.value = 0.002;
          limiter.release.value = 0.1;
          limiter.connect(ctx.destination);
          viktorShared = { ctx, limiter, impulse: viktorImpulse(ctx) };
        } catch (e) {
          console.warn('Viktor init failed:', e);
          viktorFailed = true;
          try { if (ctx) ctx.close(); } catch {}
        }
        return viktorShared;
      }

      function viktorEnsure(mid) {
        const rt = viktorRts.get(mid);
        if (rt) return rt;
        const sh = viktorSharedEnsure();
        if (!sh) return null;
        try {
          // upstream daw.js runs `new AudioContext()` on whatever constructor
          // we hand it; a constructor returning an object overrides `this`,
          // so every engine lands on the one shared context
          const engine = NV1.create(function () { return sh.ctx; },
            VIKTOR_NULL_STORE).dawEngine;
          // splice our volume gain between the engine's master out and the
          // shared limiter — patches overwrite engine.masterVolume on load
          engine.masterVolume.disconnect();
          const volumeNode = sh.ctx.createGain();
          engine.masterVolume.connect(volumeNode);
          volumeNode.connect(sh.limiter);
          engine.reverb.convolver.buffer = sh.impulse;
          const made = {
            engine,
            ctx: sh.ctx,
            volumeNode,
            timers: new Set(),
            sounding: new Map(),
            loadedPatch: '',
          };
          viktorRts.set(mid, made);
          return made;
        } catch (e) {
          console.warn('Viktor engine create failed:', e);
          viktorFailed = true;
          return null;
        }
      }

      function viktorNames() {
        return window.NV1 ? Object.keys(NV1.defaultPatches) : [];
      }

      function viktorSetPatch(mid, name) {
        const v = viktorEnsure(mid);
        if (!v || v.loadedPatch === name) return;
        const src =
          NV1.defaultPatches[name] ||
          NV1.defaultPatches[VIKTOR_DEFAULT_PATCH_NAME];
        // deep-clone: loadPatch/settings-convertor transposes values in place
        v.engine.loadPatch(JSON.parse(JSON.stringify(src)), true);
        v.loadedPatch = name;
      }
```

(keep the `VIKTOR_MAKEUP` comment + const here, unchanged, then:)

```js
      function viktorSetVolume(mid, vol) {
        const v = viktorEnsure(mid);
        if (!v) return;
        const x = clamp(+vol || 0, 0, 1) * VIKTOR_MAKEUP;
        // short ramp so slider drags don't zipper mid-note
        if (v.ctx.state === 'running')
          v.volumeNode.gain.setTargetAtTime(x, v.ctx.currentTime, 0.015);
        else v.volumeNode.gain.value = x;
      }

      // hold each event on a timer until its due time — the engine's MIDI path
      // plays immediately; forwarding on arrival would quantize the note grid
      // to the 25ms scheduler wakeups (see learnings.md)
      function viktorNote(mid, ev) {
        const v = viktorEnsure(mid);
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

      function viktorPanicRt(v) {
        for (const t of v.timers) clearTimeout(t);
        v.timers.clear();
        for (const pitch of v.sounding.keys())
          v.engine.externalMidiMessage({ data: [0x80, pitch, 0] });
        v.sounding.clear();
      }

      function viktorPanic() {
        for (const v of viktorRts.values()) viktorPanicRt(v);
      }

      // module deleted (or patch replaced): silence it and unhook its chain.
      // The engine has no destroy API — disconnect and let GC take it.
      function viktorDispose(mid) {
        const v = viktorRts.get(mid);
        if (!v) return;
        viktorPanicRt(v);
        try { v.engine.masterVolume.disconnect(); } catch {}
        try { v.volumeNode.disconnect(); } catch {}
        viktorRts.delete(mid);
      }

      function viktorDisposeAll() {
        for (const mid of [...viktorRts.keys()]) viktorDispose(mid);
      }

      // debug handle (same idiom as window.__SEQ)
      window.__VIKTOR = () => viktorRts;
```

- [ ] **Step 2: Update `TYPES.VIKTOR.onInput`**

In `TYPES.VIKTOR` replace the body of `onInput` (keep the surrounding `defaults`, `inputs`, `outputs`):

```js
          onInput(ctx, m, port, ev) {
            if (port !== 'in' || ev.kind !== 'note') return;
            if (!viktorEnsure(m.id)) {
              ctx.viktorError = viktorFailed;
              return;
            }
            // idempotent re-asserts: cheap, and self-healing across init order
            viktorSetPatch(m.id, m.params.patchName);
            viktorSetVolume(m.id, m.params.volume);
            viktorNote(m.id, ev);
            m.state.activity = true;
            clearTimeout(m.state._actT);
            m.state._actT = setTimeout(() => {
              m.state.activity = false;
            }, 80);
          },
```

- [ ] **Step 3: App-side call sites**

a) Add a `viktorModules` computed directly after the existing `viktorModule()` computed (leave `viktorModule` in place — the panel template still binds it until Task 3):

```js
          viktorModules() {
            return this.modules.filter((m) => m.type === 'VIKTOR');
          },
```

b) Replace `applyViktorParams` body:

```js
          // shared by panel edits and boot-time gesture arming
          applyViktorParams() {
            for (const m of this.viktorModules) {
              if (viktorEnsure(m.id)) {
                viktorSetPatch(m.id, m.params.patchName);
                viktorSetVolume(m.id, m.params.volume);
              }
            }
          },
```

c) In `addModule`, replace the shared CLOCK/VIKTOR guard:

```js
            if (type === 'CLOCK' || type === 'VIKTOR') {
              const existing = this.modules.find((m) => m.type === type);
              if (existing) {
                this.setStatus('only one ' + type + ' module', true);
                return existing;
              }
            }
```

with:

```js
            if (type === 'CLOCK') {
              const existing = this.modules.find((m) => m.type === type);
              if (existing) {
                this.setStatus('only one CLOCK module', true);
                return existing;
              }
            }
            if (type === 'VIKTOR') {
              const viks = this.modules.filter((m) => m.type === 'VIKTOR');
              if (viks.length >= VIKTOR_MAX) {
                this.setStatus('max ' + VIKTOR_MAX + ' VIKTOR modules', true);
                return viks[viks.length - 1];
              }
            }
```

d) In `removeModule`, capture the module before the splice and dispose Viktors. Replace:

```js
          removeModule(id) {
            const i = this.modules.findIndex((m) => m.id === id);
            if (i < 0) return;
            this.modules.splice(i, 1);
```

with:

```js
          removeModule(id) {
            const i = this.modules.findIndex((m) => m.id === id);
            if (i < 0) return;
            // removing a VIKTOR unplugs the synth itself — silencing its
            // ringing notes is correct here (contrast the no-panic() rule
            // below, which is about *cable* edits)
            if (this.modules[i].type === 'VIKTOR') viktorDispose(id);
            this.modules.splice(i, 1);
```

e) In `load(data)`, dispose all engine runtimes before the module wipe. Replace:

```js
          load(data) {
            this.modules.splice(0, this.modules.length);
```

with:

```js
          load(data) {
            viktorDisposeAll(); // old module ids die with the old patch
            this.modules.splice(0, this.modules.length);
```

f) Boot arming — replace `if (this.viktorModule) {` with `if (this.viktorModules.length) {` (anchor comment: `boot patch already contains a VIKTOR module`).

- [ ] **Step 4: Syntax check + harness**

Run: `node --check <(sed -n '/VIKTOR NV-1 — embedded synth engine shim/,/debug handle (same idiom/p' index.html)` — cheap sanity only; the real gate is the harness.
Run: `bash $S/run-multi-viktor.sh`
Expected: T1–T7 PASS. T8 FAIL (`panels=1 anchored=false` — pane still renders the single `viktorModule`). BYTES PASS.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Multi-Viktor core: per-module engine registry on one shared AudioContext

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Stacked synth pane UI

**Files:**
- Modify: `index.html` — `#tmpl-viktor-panel` template (~2083), `#tmpl-viktor` OPEN button (~2071), `<viktor-panel>` usage in the app template (~1225), `ViktorPanel` component (~3652), `ModuleViktor` inject (~3644), App `provide()` (anchor: `seqCables: computed`), `viktorModule` computed removal (~3790), CSS near `#viktor-pane .viktor-panel` (~920).

**Interfaces:**
- Consumes: `viktorModules` computed, `viktorEnsure(mid)` etc. from Task 2.
- Produces: `ViktorPanel` takes prop `modules: Array`; panels carry `:id="'viktor-panel-' + m.id"`; App provides `seqOpenViktor(mid)`.

- [ ] **Step 1: Template**

Replace the whole `#tmpl-viktor-panel` template with:

```html
    <template id="tmpl-viktor-panel">
      <div id="viktor-pane">
        <div v-if="error" class="viktor-empty">
          <p>Viktor engine unavailable in this browser (WebAudio required).</p>
        </div>
        <div v-else-if="!modules.length" class="viktor-empty">
          <p>No VIKTOR module in the rack.</p>
          <button @click="$emit('add')">+ ADD VIKTOR</button>
        </div>
        <div v-else class="viktor-panels">
          <div
            v-for="m in modules"
            :key="m.id"
            :id="'viktor-panel-' + m.id"
            class="viktor-panel"
          >
            <div class="viktor-head">
              VIKTOR NV-1 <span class="viktor-mid">#{{ m.id }}</span>
            </div>
            <div class="viktor-patch-big">{{ m.params.patchName }}</div>
            <div class="row">
              <button @click="step(m, -1)">‹ PREV</button>
              <select v-model="m.params.patchName" @change="$emit('change')">
                <option v-for="n in patchNames" :key="n" :value="n">{{ n }}</option>
              </select>
              <button @click="step(m, 1)">NEXT ›</button>
            </div>
            <div class="row">
              <label>VOLUME</label>
              <input
                type="range"
                min="0"
                max="1"
                step="0.01"
                v-model.number="m.params.volume"
                @input="$emit('change')"
              />
              <span class="viktor-vol-pct">{{ Math.round(m.params.volume * 100) }}%</span>
            </div>
            <p class="viktor-note">
              64 factory patches. Sound-shaping knobs land in a later phase.
            </p>
          </div>
        </div>
      </div>
    </template>
```

- [ ] **Step 2: Component + usage**

a) `ViktorPanel`: replace the `module` prop with `modules` and make `step` take the module:

```js
      const ViktorPanel = defineComponent({
        template: '#tmpl-viktor-panel',
        props: {
          modules: { type: Array, default: () => [] },
          patchNames: { type: Array, default: () => [] },
          error: { type: Boolean, default: false },
        },
        emits: ['add', 'change'],
        methods: {
          step(m, d) {
            const names = this.patchNames;
            if (!names.length) return;
            const i = names.indexOf(m.params.patchName);
            m.params.patchName = names[(i + d + names.length) % names.length];
            this.$emit('change');
          },
        },
      });
```

b) App template usage: change `:module="viktorModule"` to `:modules="viktorModules"` (anchor: `<viktor-panel`).

c) Delete the now-unused `viktorModule()` computed (keep `viktorModules`). Verify with `grep -c 'viktorModule\b' index.html` that no singular references remain.

- [ ] **Step 3: OPEN scrolls to the module's panel**

a) In App `provide()` (same object that provides `seqCables`), add:

```js
            seqOpenViktor: (mid) => {
              this.setView('viktor');
              nextTick(() => {
                const el = document.getElementById('viktor-panel-' + mid);
                if (el) el.scrollIntoView({ block: 'nearest' });
              });
            },
```

b) In `ModuleViktor`, extend inject: `inject: { seqSetView: { default: () => () => {} }, seqOpenViktor: { default: () => () => {} } },`

c) In `#tmpl-viktor`, change the OPEN button to `<button @click="seqOpenViktor(module.id)">OPEN</button>`.

- [ ] **Step 4: CSS**

Next to the existing `#viktor-pane .viktor-panel` rule add:

```css
      #viktor-pane .viktor-panels {
        display: flex;
        flex-direction: column;
        gap: 18px;
        overflow-y: auto;
        max-height: 100%;
        min-height: 0;
      }
      #viktor-pane .viktor-head .viktor-mid {
        opacity: 0.55;
        font-weight: normal;
      }
```

Check the existing `#viktor-pane` rule (~887): if it centers a single panel (e.g. `align-items: center; justify-content: center`), keep centering horizontal-only so multiple panels start at the top (`justify-content: flex-start` when panels overflow is fine — use your judgment against the actual rule, the requirement is: 4 panels visible by scrolling, none clipped).

- [ ] **Step 5: Harness to green + visual spot-check**

Run: `bash $S/run-multi-viktor.sh`
Expected: T1–T8 all PASS, BYTES PASS.

Visual spot-check — screenshot the VIKTOR view of the default boot patch (single panel; T8 already proves 4 panels mount):

```bash
cd $S && python3 -m http.server 8437 --bind 127.0.0.1 >/dev/null 2>&1 & sleep 1
rm -rf $S/shot-profile
timeout 30 google-chrome-stable --headless=new --disable-gpu \
  --autoplay-policy=no-user-gesture-required --disable-audio-output \
  --user-data-dir=$S/shot-profile --window-size=1400,900 \
  --screenshot=$S/pane.png 'http://127.0.0.1:8437/index.html#view=viktor'
kill %1
```

The app reads its view from localStorage, not the URL hash — if the shot shows the rack instead of the pane, accept it: the layout gate is the T8 DOM assertion plus the CSS review in Step 4. Read `$S/pane.png` and confirm the page renders sanely (no blank screen, no error text).

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Synth pane stacks a panel per VIKTOR; OPEN scrolls to its panel

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Docs + final verification

**Files:**
- Modify: `SCHEMA.md` (VIKTOR section, ~152), `README.md` (built-in synth section, ~25), `learnings.md` (Viktor embed section)

**Interfaces:**
- Consumes: everything above, finished.
- Produces: released docs; final green harness run recorded in the commit message.

- [ ] **Step 1: SCHEMA.md**

Change the VIKTOR heading line `### VIKTOR  (built-in Viktor NV-1 synth; max one)` to `### VIKTOR  (built-in Viktor NV-1 synth; max 4)` and append below its params table:

```markdown
Up to **4 VIKTOR** modules may coexist — each is an independent engine
instance (own patch + volume) on one shared AudioContext, summed into a
single safety limiter. A 5th is rejected on add.
```

- [ ] **Step 2: README.md**

In the "Built-in synth (Viktor NV-1)" section, replace the sentence beginning `Add a **VIKTOR** module and cable notes into it like a MIDI OUT.` with:

```markdown
Add a **VIKTOR** module and cable notes into it like a MIDI OUT — up to four
of them, each with its own patch and volume (they share one output limiter).
The synth page stacks a panel per module; **OPEN** on a rack module jumps to
its panel.
```

- [ ] **Step 3: learnings.md**

Append to the Viktor NV-1 embed section:

```markdown
- **Sharing one AudioContext across engine instances that `new` their own:** upstream `daw.js` calls `new AudioContext()` on the constructor you pass to `NV1.create` — hand it `function () { return sharedCtx; }` and every engine lands on the shared context (a JS constructor returning an object overrides `this`). One context, one limiter, one synthesized reverb impulse buffer shared by N engines; per-engine volume gains splice in before the limiter.
```

- [ ] **Step 4: Final gate**

Run: `bash $S/run-multi-viktor.sh` — expect T1–T8 PASS + BYTES PASS.
Run: `wc -c index.html` — record the number.

- [ ] **Step 5: Commit**

```bash
git add SCHEMA.md README.md learnings.md
git commit -m "Docs: multi-Viktor (max 4, shared context + limiter)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

# PATTRIG (pattern trigger) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a new `pat` signal type and a **PATTRIG** module that recalls a STEP pattern by note — snapshot a STEP's params into a table keyed by pitch, replay them live.

**Architecture:** One new signal kind `{kind:'pat', time, params}` sits alongside `clock`/`note`/`scale` in the existing emit/drainEvents pipeline (`KIND_PRI` gains a `pat` slot between `scale` and `note`). A `withPat()` wrapper adds `pat` in/out ports to any module type that defines `getPat`/`applyPat` hooks, without touching that type's own `onInput` — STEP is the only wrapped type for v1. `TYPES.PATTRIG` is a small stateful module: a `note` input recalls-or-captures against a `table` array, a `pat` input sample-and-holds the most recent pattern into `held`. Everything lives in `index.html` (single-file app, no build step).

**Tech Stack:** Vue 3 in-DOM/x-template components, headless-Chrome smoke harness (existing `run-smoke.sh` pattern, recreated fresh each session in the scratchpad).

Spec: `docs/superpowers/specs/2026-07-14-pattern-trigger-design.md`.

## Global Constraints

- Single-file app: all runtime code/CSS in `index.html`. Byte budget ≤ ~4 KB net growth (per spec).
- Back-compat: patches with no PATTRIG modules and no `pat` cables load and behave exactly as before. `KIND_PRI`'s reindex (`clock` moving from priority `2` to `3`) must not change any existing same-tick ordering behavior (EUCLID's pitch-before-clk retune still holds).
- `m.params` is the ONLY persisted module state (`serialize()` JSON-round-trips it); `m.state` is transient and reinitialized to `{}` on load — PATTRIG's `table`/`held`/`locked` belong in `params`, its debounce timer (`lastCaptureTime`) and flash-highlight belong in `state`.
- `TYPES`/`SIGNAL_COLORS` are plain top-level `const`s inside a classic (non-module) `<script>` tag — they are **not** reachable as `window.TYPES`/`window.SIGNAL_COLORS` from outside the page (only `window.__SEQ` is deliberately exposed, in `mounted()`). The smoke harness must exercise everything through `app.emit(...)`/`app.cables`/DOM, never through a direct `TYPES.X` reference.
- Do NOT commit while `index.html` has unrelated in-progress edits — the post-commit hook blanket-runs `git add index.html` and amends.
- Never Read/cat whole `index.html` (777 KB+, very long lines); navigate with `grep -n` and offset-limited `Read`.
- Harness verification: serve the repo root over HTTP (so `iframe src="index.html"` resolves), run headless Chrome for a real ~6s wall-clock window, grep its stderr for `SMOKE:`/`ok`/`FAIL` markers (same idiom as the STEP mute/skip harness — proven to work in this environment: `--enable-logging=stderr` surfaces `console.log`). `run-smoke.sh` does not exist on disk this session — Task 1 recreates it in the scratchpad.

---

### Task 1: Failing smoke harness (`pat-smoke.html` + `run-smoke.sh`)

**Files:**
- Create: `<scratchpad>/run-smoke.sh` (harness runner — scratchpad, not committed)
- Create: `<scratchpad>/pat-smoke.html` (test harness — scratchpad, not committed)

**Interfaces:**
- Consumes: `window.__SEQ` (app instance: `addModule(type,x,y)`, `modules`, `cables`, `emit(m,port,ev)`, `_evq`/`_draining` (internal event-queue batching flag, used to force two deliveries into the same same-time bucket), `transport`, `serialize()`, `load(data)`), plus DOM (`.module[data-mid]`, `.stoplight`, `.table-row`, `.table-row .x`, `#cables path.cable[stroke]`) once later tasks render them.
- Produces: the acceptance suite Tasks 2–6 must turn green, group by group. Each `check()` name is prefixed `G1`…`G15` (plus one `G-setup-pattrig` fixture group) so partial-pass expectations can be verified by substring grep. Each group runs inside a try/catch wrapper (`group(name, fn)`) so one group's exception can't hide whether earlier/later groups pass — this matters because most groups only become meaningful once a later task lands (e.g. `G4`–`G13` need `TYPES.PATTRIG` to exist, added in Task 4).

- [ ] **Step 1: Write `run-smoke.sh`**

```bash
#!/usr/bin/env bash
set -uo pipefail
HARNESS="$1"
REPO="/Users/tmoney/code/vibes/lambda-sequencer"
NAME="$(basename "$HARNESS")"
cp "$HARNESS" "$REPO/$NAME"
cd "$REPO"
python3 -m http.server 8437 >/tmp/smoke-http.log 2>&1 &
SRV_PID=$!
sleep 1
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-sandbox --enable-logging=stderr --v=1 \
  "http://localhost:8437/$NAME" > /tmp/smoke-stdout.log 2>/tmp/smoke-stderr.log &
CHROME_PID=$!
sleep 6
kill "$CHROME_PID" 2>/dev/null
kill "$SRV_PID" 2>/dev/null
rm -f "$REPO/$NAME"
echo "--- SMOKE marker ---"
grep -o 'SMOKE: [^"]*' /tmp/smoke-stderr.log | tail -3
echo "--- FAIL lines ---"
grep '^FAIL' /tmp/smoke-stderr.log || echo "(none)"
echo "--- ok count ---"
grep -c '^ok  ' /tmp/smoke-stderr.log || echo 0
```

```bash
chmod +x <scratchpad>/run-smoke.sh
```

- [ ] **Step 2: Write the harness `pat-smoke.html`**

Same iframe pattern as the STEP mute/skip harness, but with two additions: a `group()` wrapper so one missing feature can't mask others, and a "synthetic source" technique (a bare `{id: N}` object plus a manually-pushed cable) for injecting an event straight into any module's input port without needing a second real module upstream of it. `app.emit(m, port, event)` only reads `m.id` off the source and looks up cables by `c.from.mid`/`c.from.port` — it never requires `m` to be a real registered module — so `app.emit({id: 80001}, 'n', {kind:'note', ...})` delivers cleanly to anything cabled from `{mid: 80001, port: 'n'}`.

Full content:

```html
<!doctype html>
<html>
<head><meta charset="utf-8"><title>pat smoke</title></head>
<body>
<iframe id="f" src="index.html" style="width:1600px;height:900px;border:0"></iframe>
<script>
  const results = [];
  function check(name, cond, detail) {
    results.push({ name, ok: !!cond });
    console.log((cond ? 'ok  ' : 'FAIL') + ' - ' + name + (cond ? '' : ' :: ' + detail));
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function group(name, fn) {
    try {
      await fn();
    } catch (e) {
      check(name + ' (no exception)', false, 'threw: ' + (e && e.message));
    }
  }

  async function main() {
    const f = document.getElementById('f');
    const W = f.contentWindow;
    for (let i = 0; i < 200 && !(W.__SEQ && W.__SEQ.$refs && W.__SEQ.$refs.canvas); i++) await sleep(50);
    const app = W.__SEQ;
    if (!app) { console.log('SMOKE: FAIL (no __SEQ)'); return; }
    const doc = W.document;

    app.modules.length = 0;
    app.cables.length = 0;
    app.selectedModuleIds = [];
    app.transport.playing = true;
    await sleep(100);

    // ---- shared fixtures: clock + editor STEP + player STEP ----
    const clock = app.addModule('CLOCK', 20, 40);
    const stepEditor = app.addModule('STEP', 300, 40);
    const stepPlayer = app.addModule('STEP', 700, 40);
    app.cables.push({ from: { mid: clock.id, port: '1/16' }, to: { mid: stepPlayer.id, port: 'clk' }, type: 'clock' });
    app.cables.push({ from: { mid: stepEditor.id, port: 'pat' }, to: { mid: stepPlayer.id, port: 'pat' }, type: 'pat' });
    await sleep(150);

    await group('G1', async () => {
      stepEditor.params.len = 4;
      stepEditor.params.steps[0] = { on: true, pitch: 71, vel: 100 };
      stepEditor.params.steps[1] = { on: true, pitch: 72, vel: 100 };
      stepEditor.params.steps[2] = { on: true, pitch: 73, vel: 100 };
      stepEditor.params.steps[3] = { on: true, pitch: 74, vel: 100 };
      await sleep(100);
      const eEl = doc.querySelector(`.module[data-mid="${stepEditor.id}"]`);
      const snapBtn = [...eEl.querySelectorAll('button')].find((b) => b.textContent.trim() === 'SNAPSHOT');
      if (!snapBtn) throw new Error('no SNAPSHOT button found on STEP');
      snapBtn.click();
      await sleep(100);
      check('G1 SNAPSHOT->applyPat writes steps/len onto the player STEP', stepPlayer.params.steps[0].pitch === 71 && stepPlayer.params.len === 4, JSON.stringify(stepPlayer.params.steps[0]));
      stepEditor.params.steps[0].pitch = 999;
      check('G1 getPat/applyPat clone is isolated from later editor edits', stepPlayer.params.steps[0].pitch === 71, JSON.stringify(stepPlayer.params.steps[0]));
    });

    await group('G2', async () => {
      stepPlayer.params.len = 4;
      for (let i = 0; i < 4; i++) stepPlayer.params.steps[i] = { on: true, pitch: 40 + i, vel: 100 };
      const emit0 = app.emit.bind(app);
      let playerNotes = [];
      app.emit = (m, port, ev) => {
        if (m.id === stepPlayer.id && port === 'note') playerNotes.push({ ...ev });
        return emit0(m, port, ev);
      };
      app.emit(clock, '1/16', { kind: 'clock', time: 100.125, idx: 0, period: 0.125 });
      check('G2 normal clk->note flow on a pat-capable STEP', playerNotes.length === 1 && playerNotes[0].pitch === 40, JSON.stringify(playerNotes));
      app.emit = emit0;
    });

    await group('G3', async () => {
      await sleep(50);
      const patCableIdx = app.cables.findIndex((c) => c.type === 'pat');
      const pathEl = doc.querySelectorAll('#cables path.cable')[patCableIdx];
      check('G3 pat cable renders with the pat color', !!pathEl && pathEl.getAttribute('stroke') === '#ff5ec4', pathEl && pathEl.getAttribute('stroke'));

      stepPlayer.state.pos = -1; // reset so the next clk tick lands on index 0, matching patB's pitch 90
      app.cables.push({ from: { mid: 90001, port: 'p' }, to: { mid: stepPlayer.id, port: 'pat' }, type: 'pat' });
      const patB = { steps: Array.from({ length: 4 }, (_, i) => ({ on: true, pitch: 90 + i, vel: 100 })), vel: 100, gateLen: 0.5, len: 4 };
      const emit0 = app.emit.bind(app);
      let playerNotes = [];
      app.emit = (m, port, ev) => {
        if (m.id === stepPlayer.id && port === 'note') playerNotes.push({ ...ev });
        return emit0(m, port, ev);
      };
      app._draining = true;
      app.emit(clock, '1/16', { kind: 'clock', time: 200.25, idx: 0, period: 0.125 });
      app.emit({ id: 90001 }, 'p', { kind: 'pat', time: 200.25, params: patB });
      app._draining = false;
      app.drainEvents();
      check("G3 a same-tick pat applies before that tick's clk-driven note", playerNotes.length === 1 && playerNotes[0].pitch === 90, JSON.stringify(playerNotes));
      app.emit = emit0;
    });

    // ---- PATTRIG fixtures (note/pat inputs fed via synthetic sources) ----
    let pattrig;
    await group('G-setup-pattrig', async () => {
      pattrig = app.addModule('PATTRIG', 600, 300);
      if (!pattrig) throw new Error('addModule(PATTRIG) returned null — TYPES.PATTRIG missing');
      app.cables.push({ from: { mid: 80001, port: 'n' }, to: { mid: pattrig.id, port: 'note' }, type: 'note' });
      app.cables.push({ from: { mid: 80002, port: 'p' }, to: { mid: pattrig.id, port: 'pat' }, type: 'pat' });
      await sleep(100);
    });
    const sendNote = (pitch, time) => app.emit({ id: 80001 }, 'n', { kind: 'note', time, pitch, vel: 100 });
    const sendPat = (params, time) => app.emit({ id: 80002 }, 'p', { kind: 'pat', time, params });

    await group('G4', async () => {
      pattrig.params.locked = true;
      pattrig.params.held = null;
      pattrig.params.table = [{ note: 60, pat: { steps: [{ on: true, pitch: 60, vel: 100 }], vel: 100, gateLen: 0.5, len: 1 } }];
      let out = [];
      const emit0 = app.emit.bind(app);
      app.emit = (m, port, ev) => { if (m.id === pattrig.id && port === 'pat') out.push({ ...ev }); return emit0(m, port, ev); };
      sendNote(60, 300);
      check('G4 hit emits the stored pat even when locked and held=null', out.length === 1 && out[0].params.steps[0].pitch === 60, JSON.stringify(out));
      pattrig.params.locked = false;
      app.emit = emit0;
    });

    await group('G5', async () => {
      pattrig.params.table = [];
      pattrig.params.held = { steps: [{ on: true, pitch: 77, vel: 100 }], vel: 100, gateLen: 0.5, len: 1 };
      pattrig.state.lastCaptureTime = null;
      let out = [];
      const emit0 = app.emit.bind(app);
      app.emit = (m, port, ev) => { if (m.id === pattrig.id && port === 'pat') out.push({ ...ev }); return emit0(m, port, ev); };
      sendNote(61, 400);
      check('G5 miss captures a new row', pattrig.params.table.length === 1 && pattrig.params.table[0].note === 61, JSON.stringify(pattrig.params.table));
      check('G5 miss emits the held pat', out.length === 1 && out[0].params.steps[0].pitch === 77, JSON.stringify(out));
      app.emit = emit0;
    });

    await group('G6', async () => {
      pattrig.params.table = [];
      pattrig.state.lastCaptureTime = null;
      pattrig.params.held = { steps: [{ on: true, pitch: 5, vel: 100 }], vel: 100, gateLen: 0.5, len: 1 };
      let out = [];
      const emit0 = app.emit.bind(app);
      app.emit = (m, port, ev) => { if (m.id === pattrig.id && port === 'pat') out.push({ ...ev }); return emit0(m, port, ev); };
      sendNote(10, 500.0);
      sendNote(11, 500.2);
      sendNote(12, 500.9);
      check('G6 only the first of a sub-1s burst of misses captures', pattrig.params.table.length === 1 && pattrig.params.table[0].note === 10, JSON.stringify(pattrig.params.table));
      check('G6 only one pat emitted for the burst', out.length === 1, JSON.stringify(out));
      sendNote(13, 501.1);
      check('G6 a miss past the 1s window captures again', pattrig.params.table.length === 2 && pattrig.params.table[1].note === 13, JSON.stringify(pattrig.params.table));
      app.emit = emit0;
    });

    await group('G7', async () => {
      pattrig.params.table = [];
      pattrig.params.held = null;
      pattrig.state.lastCaptureTime = null;
      let out = [];
      const emit0 = app.emit.bind(app);
      app.emit = (m, port, ev) => { if (m.id === pattrig.id && port === 'pat') out.push({ ...ev }); return emit0(m, port, ev); };
      sendNote(20, 600);
      check('G7 miss with held=null captures nothing', pattrig.params.table.length === 0, JSON.stringify(pattrig.params.table));
      check('G7 miss with held=null emits nothing', out.length === 0, JSON.stringify(out));
      app.emit = emit0;
    });

    await group('G8', async () => {
      pattrig.params.held = { steps: [{ on: true, pitch: 1, vel: 100 }], vel: 100, gateLen: 0.5, len: 1 };
      pattrig.params.locked = true;
      pattrig.params.table = [];
      sendNote(21, 700);
      check('G8 miss while locked captures nothing', pattrig.params.table.length === 0, JSON.stringify(pattrig.params.table));
      pattrig.params.locked = false;
    });

    await group('G9', async () => {
      pattrig.params.table = [{ note: 30, pat: { steps: [{ on: true, pitch: 30, vel: 100 }], vel: 100, gateLen: 0.5, len: 1 } }];
      let out = [];
      const emit0 = app.emit.bind(app);
      app.emit = (m, port, ev) => { if (m.id === pattrig.id && port === 'pat') out.push({ ...ev }); return emit0(m, port, ev); };
      sendNote(30, 800.0);
      sendNote(30, 800.1);
      check('G9 back-to-back hits are not rate-limited by the miss debounce', out.length === 2, JSON.stringify(out));
      app.emit = emit0;
    });

    await group('G10', async () => {
      sendPat({ steps: [{ on: true, pitch: 5, vel: 100 }], vel: 100, gateLen: 0.5, len: 1 }, 900);
      check('G10 pat input updates held (sample-and-hold)', pattrig.params.held.steps[0].pitch === 5, JSON.stringify(pattrig.params.held));
    });

    // ---- G11/G12/G13 share a fresh PATTRIG fixture, DOM-driven ----
    let pattrig2;
    await group('G11', async () => {
      app.modules.length = 0;
      app.cables.length = 0;
      await sleep(100);
      const editor2 = app.addModule('STEP', 300, 40);
      pattrig2 = app.addModule('PATTRIG', 600, 40);
      if (!pattrig2) throw new Error('addModule(PATTRIG) returned null');
      app.cables.push({ from: { mid: editor2.id, port: 'pat' }, to: { mid: pattrig2.id, port: 'pat' }, type: 'pat' });
      editor2.params.len = 2;
      editor2.params.steps[0] = { on: true, pitch: 44, vel: 100 };
      await sleep(150);
      const pEl = doc.querySelector(`.module[data-mid="${pattrig2.id}"]`);
      if (!pEl) throw new Error('no .module[PATTRIG] rendered — component not registered yet');
      check('G11 stoplight starts "No pat"', pEl.querySelector('.stoplight').textContent.includes('No pat'), pEl.querySelector('.stoplight').textContent);
      const eEl = doc.querySelector(`.module[data-mid="${editor2.id}"]`);
      const snapBtn = [...eEl.querySelectorAll('button')].find((b) => b.textContent.trim() === 'SNAPSHOT');
      snapBtn.click();
      await sleep(100);
      check('G11 stoplight flips to "Ready" after SNAPSHOT', pEl.querySelector('.stoplight').textContent.includes('Ready'), pEl.querySelector('.stoplight').textContent);
      check('G11 held captured the editor pattern', pattrig2.params.held && pattrig2.params.held.steps[0].pitch === 44, JSON.stringify(pattrig2.params.held));
    });

    await group('G12', async () => {
      if (!pattrig2) throw new Error('G11 did not hand off a fixture');
      pattrig2.params.table = [
        { note: 40, pat: { steps: [{ on: true, pitch: 40, vel: 100 }], vel: 100, gateLen: 0.5, len: 1 } },
        { note: 41, pat: { steps: [{ on: true, pitch: 41, vel: 100 }], vel: 100, gateLen: 0.5, len: 1 } },
      ];
      await sleep(100);
      const pEl = doc.querySelector(`.module[data-mid="${pattrig2.id}"]`);
      check('G12 two table rows render', pEl.querySelectorAll('.table-row').length === 2, String(pEl.querySelectorAll('.table-row').length));
      const lockBtn = [...pEl.querySelectorAll('button')].find((b) => b.textContent.trim() === 'LOCK');
      lockBtn.click();
      await sleep(50);
      check('G12 LOCK click sets params.locked', pattrig2.params.locked === true, String(pattrig2.params.locked));
      check('G12 LOCK button shows on state', lockBtn.classList.contains('on'), lockBtn.className);
      const rowX = pEl.querySelector('.table-row .x');
      rowX.click();
      await sleep(50);
      check('G12 row [x] removes one row', pattrig2.params.table.length === 1, JSON.stringify(pattrig2.params.table));
      const clearAllBtn = [...pEl.querySelectorAll('button')].find((b) => b.textContent.trim() === 'CLEAR ALL');
      clearAllBtn.click();
      await sleep(50);
      check('G12 CLEAR ALL empties the table', pattrig2.params.table.length === 0, JSON.stringify(pattrig2.params.table));
    });

    await group('G13', async () => {
      if (!pattrig2) throw new Error('G11 did not hand off a fixture');
      pattrig2.params.locked = true;
      pattrig2.params.held = { steps: [{ on: true, pitch: 44, vel: 100 }], vel: 100, gateLen: 0.5, len: 2 };
      pattrig2.params.table = [{ note: 44, pat: pattrig2.params.held }];
      const ser = app.serialize();
      const serPattrig = ser.modules.find((m) => m.id === pattrig2.id);
      check('G13 serialize keeps table/held/locked', serPattrig.params.locked === true && serPattrig.params.table.length === 1, JSON.stringify(serPattrig.params));
      const serPatCables = ser.cables.filter((c) => c.type === 'pat');
      check('G13 serialize keeps pat-typed cables', serPatCables.length === 1, JSON.stringify(serPatCables));
      app.load(ser);
      await sleep(150);
      const reloaded = app.modules.find((m) => m.type === 'PATTRIG');
      check('G13 load restores table/held/locked', reloaded && reloaded.params.locked === true && reloaded.params.table.length === 1 && reloaded.params.held.steps[0].pitch === 44, JSON.stringify(reloaded && reloaded.params));
      check('G13 load restores the pat cable', app.cables.some((c) => c.type === 'pat'), JSON.stringify(app.cables));
    });

    await group('G14', async () => {
      app.modules.length = 0;
      app.cables.length = 0;
      await sleep(100);
      const clock3 = app.addModule('CLOCK', 20, 40);
      const pitchSrc = app.addModule('STEP', 300, 40);
      const euclid = app.addModule('EUCLID', 600, 40);
      app.cables.push({ from: { mid: clock3.id, port: '1/16' }, to: { mid: euclid.id, port: 'clk' }, type: 'clock' });
      app.cables.push({ from: { mid: pitchSrc.id, port: 'note' }, to: { mid: euclid.id, port: 'pitch' }, type: 'note' });
      euclid.params.hits = 16; euclid.params.steps = 16; euclid.params.rot = 0; euclid.state.pos = -1;
      let euclidNotes = [];
      const emit0 = app.emit.bind(app);
      app.emit = (m, port, ev) => { if (m.id === euclid.id && port === 'note') euclidNotes.push({ ...ev }); return emit0(m, port, ev); };
      app._draining = true;
      app.emit(clock3, '1/16', { kind: 'clock', time: 1000, idx: 0, period: 0.125 });
      app.emit(pitchSrc, 'note', { kind: 'note', time: 1000, pitch: 84, vel: 100, gateLen: 0.1 });
      app._draining = false;
      app.drainEvents();
      check('G14 pitch retune still applies before the coincident clk hit', euclidNotes.length === 1 && euclidNotes[0].pitch === 84, JSON.stringify(euclidNotes));
      app.emit = emit0;
    });

    await group('G15', async () => {
      app.load({
        bpm: 120, source: 'internal',
        modules: [
          { id: 1, type: 'CLOCK', x: 10, y: 10, params: { mode: 'internal', bpm: 120 }, disabled: {} },
          { id: 2, type: 'STEP', x: 200, y: 10, params: { len: 2, steps: [{ on: true, pitch: 62, vel: 100 }, { on: true, pitch: 64, vel: 100 }] }, disabled: {} },
        ],
        cables: [{ from: { mid: 1, port: '1/16' }, to: { mid: 2, port: 'clk' }, type: 'clock' }],
      });
      await sleep(100);
      const legacyStep = app.modules.find((m) => m.type === 'STEP');
      check('G15 legacy patch (no PATTRIG) loads cleanly', legacyStep && legacyStep.params.steps[0].pitch === 62, JSON.stringify(legacyStep && legacyStep.params));
    });

    const bad = results.filter((r) => !r.ok);
    console.log(bad.length ? 'SMOKE: FAIL (' + bad.map((b) => b.name).join('; ') + ')' : 'SMOKE: PASS');
  }
  main().catch((e) => console.log('SMOKE: FAIL (exception: ' + (e && e.message) + ')'));
</script>
</body>
</html>
```

- [ ] **Step 3: Run it — expect RED**

Run: `<scratchpad>/run-smoke.sh <scratchpad>/pat-smoke.html`
Expected: `SMOKE: FAIL`. `G1 (no exception)` fails (`no SNAPSHOT button found on STEP`). `G2` and `G14`/`G15` (pure regression checks, unaffected by anything not yet built) already pass — that's fine. `G3`'s cable-color check fails (`SIGNAL_COLORS.pat` undefined → `pathEl.getAttribute('stroke')` is `null`/some other color); its ordering check also fails. `G-setup-pattrig (no exception)` fails (`addModule('PATTRIG')` returns `null`, `TYPES.PATTRIG` doesn't exist yet), which cascades: `G4`–`G13` all fail with their own `(no exception)` markers (each references `pattrig`/`pattrig2`, both `undefined`). The suite as a whole must report `SMOKE: FAIL`.

No commit (harness lives in the scratchpad, outside the repo).

---

### Task 2: `pat` signal foundations — color, CSS var, jack color, `KIND_PRI`, palette slot

**Files:**
- Modify: `index.html` — `:root` CSS vars (~line 48), `.module .jack.*` CSS (~line 443), `SIGNAL_COLORS` (~line 2276), `PALETTE` (~line 2282), `drainEvents()`'s `KIND_PRI` (~line 4333)

**Interfaces:**
- Consumes: nothing new.
- Produces: `SIGNAL_COLORS.pat`, `--pat` CSS var, `.jack.pat` color, `KIND_PRI = { scale: 0, pat: 1, note: 2, clock: 3 }`, `'PATTRIG'` present in `PALETTE` (component/type not registered yet — the palette button will be inert until Task 5, that's fine, nothing renders it until then since `componentFor('PATTRIG')` returns `null`).

- [ ] **Step 1: `:root` CSS var** — find with `grep -n -- "--good: #5fff9c" index.html`. After that line add:

```css
        --pat: #ff5ec4;
```

- [ ] **Step 2: jack color** — find with `grep -n "jack.scale" index.html`. The block:

```css
      .module .jack.scale {
        color: var(--scale);
      }
```

gets a new rule right after it:

```css
      .module .jack.pat {
        color: var(--pat);
      }
```

- [ ] **Step 3: `SIGNAL_COLORS`** — find with `grep -n "const SIGNAL_COLORS" index.html`. Current:

```js
      const SIGNAL_COLORS = {
        clock: '#ffffff',
        note: '#ffd84a',
        scale: '#3fd9aa',
      };
```

becomes:

```js
      const SIGNAL_COLORS = {
        clock: '#ffffff',
        note: '#ffd84a',
        scale: '#3fd9aa',
        pat: '#ff5ec4',
      };
```

- [ ] **Step 4: `PALETTE`** — find with `grep -n "const PALETTE" index.html`. Insert `'PATTRIG',` right after `'STEP',`:

```js
      const PALETTE = [
        'CLOCK',
        'DIV',
        'STEP',
        'PATTRIG',
        'EUCLID',
        'TRANSPOSE',
        'QUANT',
        'CHORD',
        'CHANCE',
        'SCL',
        'MIDIOUT',
        'VIKTOR',
      ];
```

- [ ] **Step 5: `KIND_PRI`** — find with `grep -n "const KIND_PRI" index.html`. Current:

```js
              const KIND_PRI = { scale: 0, note: 1, clock: 2 };
```

becomes:

```js
              const KIND_PRI = { scale: 0, pat: 1, note: 2, clock: 3 };
```

- [ ] **Step 6: Run harness — `G3`'s cable-color check now green, everything else unchanged from Task 1**

Run: `<scratchpad>/run-smoke.sh <scratchpad>/pat-smoke.html`
Expected: `SMOKE: FAIL`. `G3 pat cable renders with the pat color` now passes (`SIGNAL_COLORS.pat` exists and the cable was already pushed with `type: 'pat'` regardless of whether STEP understands that port yet). `G3`'s ordering check still fails (STEP's `onInput` still ignores `port === 'pat'` entirely, so `patB` never applies — the tick's note still comes from whatever `stepPlayer.params.steps[0]` already was). `G1`/`G-setup-pattrig`/`G4`–`G13` still fail exactly as in Task 1.

No commit yet (feature incomplete).

---

### Task 3: `withPat()` + STEP integration (`getPat`/`applyPat`, ports, SNAPSHOT button)

**Files:**
- Modify: `index.html` — insert `withPat()` before `const TYPES = {` (~line 2612), wrap `TYPES.STEP` (~line 2630), add `patSnapshotMixin` near `baseProps`/`baseEmits` (~line 3436), add `mixins: [patSnapshotMixin]` to `ModuleStep` (~line 3489), STEP template ports + SNAPSHOT button (`#tmpl-step`, ~lines 1647–1748)

**Interfaces:**
- Consumes: `SIGNAL_COLORS.pat`/`KIND_PRI.pat` from Task 2 (cable coloring and ordering already correct once STEP has the port).
- Produces: `TYPES.STEP.inputs`/`outputs` gain a `pat` port each; `TYPES.STEP.getPat(m)` / `applyPat(m, pat)`; `patSnapshotMixin` (usable by any future `withPat()`-wrapped module's component); STEP's panel gets a SNAPSHOT button.

- [ ] **Step 1: `withPat()`** — find the `TYPES` object start with `grep -n "const TYPES = {" index.html`. Insert immediately before it:

```js
      function withPat(def) {
        return {
          ...def,
          inputs: [...def.inputs, { name: 'pat', type: 'pat' }],
          outputs: [...def.outputs, { name: 'pat', type: 'pat' }],
          onInput(ctx, m, port, ev) {
            if (port === 'pat' && ev.kind === 'pat') {
              def.applyPat(m, ev.params);
              return;
            }
            return def.onInput(ctx, m, port, ev);
          },
        };
      }
```

- [ ] **Step 2: wrap `TYPES.STEP`** — find with `grep -n "STEP: {" index.html`. The entry currently opens `STEP: {` and closes with `},` right before `EUCLID: {`. Change the opening line:

```js
        STEP: {
```

to:

```js
        STEP: withPat({
```

and change its closing `},` (the one immediately before `EUCLID: {`) to `}),`, and add two hooks right before that closing line (after the `onInput(ctx, m, port, ev) { ... }` method's closing `},`):

```js
          getPat: (m) => JSON.parse(JSON.stringify(m.params)),
          applyPat: (m, pat) => Object.assign(m.params, JSON.parse(JSON.stringify(pat))),
```

So the tail of the entry reads:

```js
          onInput(ctx, m, port, ev) {
            /* ...unchanged body... */
          },
          getPat: (m) => JSON.parse(JSON.stringify(m.params)),
          applyPat: (m, pat) => Object.assign(m.params, JSON.parse(JSON.stringify(pat))),
        }),
```

- [ ] **Step 3: `patSnapshotMixin`** — find with `grep -n "const baseEmits = \[" index.html`, then find the closing `];` of that array. Insert right after it (before `const ModuleClock = defineComponent`):

```js
      const patSnapshotMixin = {
        methods: {
          snapshotPat() {
            this.$root.emit(this.module, 'pat', {
              kind: 'pat',
              time: null,
              params: TYPES[this.module.type].getPat(this.module),
            });
          },
        },
      };
```

- [ ] **Step 4: wire the mixin into `ModuleStep`** — find with `grep -n "const ModuleStep = defineComponent" index.html`. Current:

```js
      const ModuleStep = defineComponent({
        template: '#tmpl-step',
        components: { ModuleFrame },
        props: baseProps,
        emits: baseEmits,
```

becomes:

```js
      const ModuleStep = defineComponent({
        template: '#tmpl-step',
        components: { ModuleFrame },
        props: baseProps,
        emits: baseEmits,
        mixins: [patSnapshotMixin],
```

- [ ] **Step 5: STEP template ports** — find with `grep -n "tmpl-step" index.html`. The `module-frame` tag's `:inputs`/`:outputs`:

```
        :inputs="[{name:'clk',type:'clock'}]"
        :outputs="[{name:'note',type:'note'}]"
```

become:

```
        :inputs="[{name:'clk',type:'clock'},{name:'pat',type:'pat'}]"
        :outputs="[{name:'note',type:'note'},{name:'pat',type:'pat'}]"
```

- [ ] **Step 6: SNAPSHOT button** — in `#tmpl-step`, find the `»` rotate button (`grep -n "rotate the pattern one step right" index.html`, the `</button>` a few lines below it closes the VEL/GATE/LEN/×2/«/» row). Add a new button right after that `</button>` and before the row's closing `</div>`:

```html
          <button
            class="x2-btn"
            @click="snapshotPat"
            title="Emit this pattern as a pat signal (e.g. into a PATTRIG)"
          >
            SNAPSHOT
          </button>
```

- [ ] **Step 7: Run harness — `G1`, `G3`'s ordering check now green too**

Run: `<scratchpad>/run-smoke.sh <scratchpad>/pat-smoke.html`
Expected: `SMOKE: FAIL`, but now only `G-setup-pattrig`/`G4`–`G13` fail (`addModule('PATTRIG', ...)` still returns `null` since `TYPES.PATTRIG` doesn't exist). `G1`, `G2`, `G3` (both checks) must show `ok`.

No commit yet (feature incomplete).

---

### Task 4: `TYPES.PATTRIG` module type (table logic)

**Files:**
- Modify: `index.html` — add a new `PATTRIG:` entry to `TYPES` (~line 2688, right after `STEP`'s closing `}),` and before `EUCLID: {`)

**Interfaces:**
- Consumes: `withPat`/`SIGNAL_COLORS.pat`/`KIND_PRI` from Tasks 2–3 (PATTRIG itself isn't wrapped by `withPat` — it natively declares `pat` in/out ports since that's its whole purpose).
- Produces: `TYPES.PATTRIG` with `inputs: [note, pat]`, `outputs: [pat]`, `defaults()`, `onInput(ctx, m, port, ev)`. No Vue component/template yet — `addModule('PATTRIG', ...)` will work (mutate `params`/`state` directly) but nothing renders on canvas until Task 5.

- [ ] **Step 1: add the `PATTRIG` entry** — find the insertion point with `grep -n "EUCLID: {" index.html`; insert the new entry immediately before that line:

```js
        PATTRIG: {
          inputs: [
            { name: 'note', type: 'note' },
            { name: 'pat', type: 'pat' },
          ],
          outputs: [{ name: 'pat', type: 'pat' }],
          defaults: () => ({
            locked: false,
            held: null,
            table: [],
          }),
          onInput(ctx, m, port, ev) {
            if (port === 'pat' && ev.kind === 'pat') {
              m.params.held = ev.params;
              return;
            }
            if (port !== 'note' || ev.kind !== 'note') return;
            const flash = (pitch) => {
              m.state.flashNote = pitch;
              clearTimeout(m.state._flashT);
              m.state._flashT = setTimeout(() => {
                m.state.flashNote = null;
              }, 200);
            };
            const row = m.params.table.find((r) => r.note === ev.pitch);
            if (row) {
              ctx.emit(m, 'pat', { kind: 'pat', time: ev.time, params: row.pat });
              flash(ev.pitch);
              return;
            }
            if (m.params.locked) return;
            if (m.params.held == null) return;
            const last = m.state.lastCaptureTime;
            if (last != null && ev.time - last < 1.0) return;
            m.params.table.push({ note: ev.pitch, pat: m.params.held });
            m.state.lastCaptureTime = ev.time;
            ctx.emit(m, 'pat', { kind: 'pat', time: ev.time, params: m.params.held });
            flash(ev.pitch);
          },
        },
```

- [ ] **Step 2: Run harness — `G-setup-pattrig` through `G10` now green, `G11`+ still red**

Run: `<scratchpad>/run-smoke.sh <scratchpad>/pat-smoke.html`
Expected: `SMOKE: FAIL`, failures confined to `G11` onward (those need the Vue component/template from Task 5 — `pEl` will be `null`/missing since no `.module.PATTRIG` renders yet, throwing `no .module[PATTRIG] rendered`). `G-setup-pattrig` through `G10` must show `ok`.

No commit yet (feature incomplete).

---

### Task 5: `ModulePattrig` component, template, CSS, registration

**Files:**
- Modify: `index.html` — new `<template id="tmpl-pattrig">` (insert after `#tmpl-step` closes, ~line 1767, before `<template id="tmpl-euclid">`), new `ModulePattrig` component (insert after `ModuleStep` closes, ~line 3697, before `ModuleEuclid`), `COMPONENT_FOR` registration (~line 3891), new `.module.PATTRIG` CSS block (insert right after the STEP CSS block ends, ~line 838, before `.module.EUCLID .ring-wrap`)

**Interfaces:**
- Consumes: `TYPES.PATTRIG` (Task 4) for the data shape (`params.table`, `params.held`, `params.locked`, `state.flashNote`), `midiToNoteName` (existing global helper, already used as `noteName` in `ModuleStep`).
- Produces: a rendered PATTRIG module — stoplight, LOCK toggle, CLEAR ALL, per-row `[x]`, table list — fully wired to `module.params`/`module.state`.

- [ ] **Step 1: template** — find the end of `#tmpl-step` with `grep -n "</template>" index.html` (the one right after the STEP `<template #help>` block, ~line 1767). Insert this whole new template right after that `</template>` closing tag, before `<template id="tmpl-euclid">`:

```html
    <template id="tmpl-pattrig">
      <module-frame
        :module="module"
        title="PATTRIG"
        :inputs="[{name:'note',type:'note'},{name:'pat',type:'pat'}]"
        :outputs="[{name:'pat',type:'pat'}]"
        @head-pointerdown="$emit('head-pointerdown', $event)"
        @port-pointerdown="$emit('port-pointerdown', $event)"
        @port-dblclick="$emit('port-dblclick', $event)"
        @remove="$emit('remove')"
        @duplicate="$emit('duplicate')"
      >
        <div class="stoplight" :class="{ ready: module.params.held !== null }">
          <span class="dot"></span>
          {{ module.params.held !== null ? 'Ready' : 'No pat' }}
        </div>
        <div class="row">
          <button
            type="button"
            class="lock-btn"
            :class="{ on: module.params.locked }"
            @click="module.params.locked = !module.params.locked; $emit('change')"
          >
            LOCK
          </button>
          <button
            type="button"
            class="clear-all-btn"
            :disabled="!module.params.table.length"
            @click="clearAll"
          >
            CLEAR ALL
          </button>
        </div>
        <div class="pat-table">
          <div
            v-for="row in module.params.table"
            :key="row.note"
            class="table-row"
            :class="{ flash: module.state.flashNote === row.note }"
          >
            <span class="note-name">{{ noteName(row.note) }}</span>
            <button type="button" class="x" @click="clearRow(row.note)">×</button>
          </div>
          <div v-if="!module.params.table.length" class="pat-table-empty">
            no patterns learned
          </div>
        </div>
        <template #help>
          Send a <b>note</b> to recall a learned pattern by pitch, or capture a
          new one: patch a <b>pat</b> signal in (e.g. a STEP's
          <b>SNAPSHOT</b> button) — the stoplight turns green once a pat has
          been received — then send an unseen note to assign it.<br />
          Repeat captures on distinct unseen notes within 1s of each other are
          ignored (only the first captures) so a fast clock can't flood the
          table. <b>LOCK</b> stops new captures; previously learned notes
          still recall. <b>CLEAR ALL</b> empties the table; each row's
          <b>×</b> clears one entry.<br />
          Patch this module's <b>pat</b> output into another STEP's
          <b>pat</b> input to switch its pattern live by note.
        </template>
      </module-frame>
    </template>
```

- [ ] **Step 2: CSS** — find with `grep -n "module.STEP .note-edit input:focus" index.html`. That rule's closing `}` is immediately followed by a blank line and then `.module.EUCLID .ring-wrap {` — insert this new block in that blank line, between the two:

```css
      .module.PATTRIG {
        min-width: 220px;
      }
      .module.PATTRIG .stoplight {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 6px 2px;
        font-size: 11px;
        letter-spacing: 0.08em;
        color: var(--dim);
      }
      .module.PATTRIG .stoplight .dot {
        width: 9px;
        height: 9px;
        border-radius: 50%;
        background: var(--note);
        box-shadow: 0 0 6px var(--note);
      }
      .module.PATTRIG .stoplight.ready {
        color: var(--good);
      }
      .module.PATTRIG .stoplight.ready .dot {
        background: var(--good);
        box-shadow: 0 0 6px var(--good);
      }
      .module.PATTRIG .lock-btn,
      .module.PATTRIG .clear-all-btn {
        flex: 1;
        background: var(--bg2);
        color: var(--text);
        border: 1px solid var(--line);
        border-radius: 4px;
        padding: 6px 9px;
        font: 600 11px/1 ui-monospace, monospace;
        letter-spacing: 0.08em;
        cursor: pointer;
        transition:
          background 0.1s,
          border-color 0.1s,
          color 0.1s;
      }
      .module.PATTRIG .lock-btn:hover,
      .module.PATTRIG .clear-all-btn:hover {
        background: var(--panel-hi);
        border-color: var(--accent);
      }
      .module.PATTRIG .lock-btn.on {
        background: var(--panel-hi);
        color: var(--pat);
        box-shadow: inset 0 0 0 1px var(--pat);
      }
      .module.PATTRIG .clear-all-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .module.PATTRIG .pat-table {
        max-height: 160px;
        overflow-y: auto;
        border: 1px solid var(--line);
        border-radius: 4px;
        margin-top: 4px;
      }
      .module.PATTRIG .table-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 8px;
        border-bottom: 1px solid var(--line);
        font-size: 12px;
        transition: background 0.15s;
      }
      .module.PATTRIG .table-row:last-child {
        border-bottom: none;
      }
      .module.PATTRIG .table-row.flash {
        background: var(--panel-hi);
      }
      .module.PATTRIG .table-row .x {
        background: transparent;
        color: var(--dim);
        border: 0;
        cursor: pointer;
        font-size: 13px;
        line-height: 1;
        padding: 0 2px;
      }
      .module.PATTRIG .table-row .x:hover {
        color: var(--bad);
      }
      .module.PATTRIG .pat-table-empty {
        padding: 10px 8px;
        color: var(--dim);
        font-size: 11px;
        text-align: center;
      }
```

- [ ] **Step 3: `ModulePattrig` component** — find with `grep -n "const ModuleEuclid = defineComponent" index.html`. Insert immediately before it (right after `ModuleStep`'s closing `});`):

```js
      const ModulePattrig = defineComponent({
        template: '#tmpl-pattrig',
        components: { ModuleFrame },
        props: baseProps,
        emits: baseEmits,
        methods: {
          noteName: midiToNoteName,
          clearAll() {
            this.module.params.table = [];
            this.$emit('change');
          },
          clearRow(note) {
            this.module.params.table = this.module.params.table.filter(
              (r) => r.note !== note,
            );
            this.$emit('change');
          },
        },
      });
```

- [ ] **Step 4: register in `COMPONENT_FOR`** — find with `grep -n "const COMPONENT_FOR" index.html`. Add `PATTRIG: ModulePattrig,` right after `STEP: ModuleStep,`:

```js
      const COMPONENT_FOR = {
        CLOCK: ModuleClock,
        STEP: ModuleStep,
        PATTRIG: ModulePattrig,
        EUCLID: ModuleEuclid,
        DIV: ModuleDiv,
        TRANSPOSE: ModuleTranspose,
        QUANT: ModuleQuant,
        CHORD: ModuleChord,
        CHANCE: ModuleChance,
        SCL: ModuleScl,
        MIDIOUT: ModuleMidiOut,
        VIKTOR: ModuleViktor,
      };
```

- [ ] **Step 5: Run full harness — expect GREEN**

Run: `<scratchpad>/run-smoke.sh <scratchpad>/pat-smoke.html`
Expected: `SMOKE: PASS`.

No commit yet — commit lands with the docs in Task 6 so the feature ships as one coherent commit.

---

### Task 6: Docs, regression sweep, commit

**Files:**
- Modify: `SCHEMA.md` (signal types list, cable `type` enum, STEP ports, new PATTRIG section)
- Modify: `README.md` (new short subsection)
- Commit: `index.html`, `SCHEMA.md`, `README.md`

- [ ] **Step 1: SCHEMA.md — signal types** — find with `grep -n "^## Signal types" SCHEMA.md`. The block:

```
## Signal types

- **clock** — a pulse `{ kind:'clock', time, idx }`. Drives step advance / gates.
- **note** — `{ kind:'note', time, pitch (0–127), vel (1–127), gateLen (seconds) }`.
- **scale** — `{ kind:'scale', root (0–11), scale (name) }`. Broadcast by SCL.

Ports only connect when types match. Notes are MIDI; middle C = 60 = C3
(Ableton octave numbering).
```

becomes:

```
## Signal types

- **clock** — a pulse `{ kind:'clock', time, idx }`. Drives step advance / gates.
- **note** — `{ kind:'note', time, pitch (0–127), vel (1–127), gateLen (seconds) }`.
- **scale** — `{ kind:'scale', root (0–11), scale (name) }`. Broadcast by SCL.
- **pat** — `{ kind:'pat', time, params }`. `params` is exactly a target
  module's `params` object (the same shape `serialize()` writes for that
  type — for now, always STEP's `{steps, vel, gateLen, len}`). Emitted by
  PATTRIG (recall) and by a STEP's SNAPSHOT button (capture); consumed by
  any module wrapped with `withPat()` (STEP only, for now).

Ports only connect when types match. Notes are MIDI; middle C = 60 = C3
(Ableton octave numbering).
```

- [ ] **Step 2: SCHEMA.md — cable `type` enum** — find with `grep -n '"clock", "note", "scale"' SCHEMA.md`. The line:

```
| `type` | string | Signal type, one of `"clock"`, `"note"`, `"scale"`. Should match the ports' types (used for cable color). |
```

becomes:

```
| `type` | string | Signal type, one of `"clock"`, `"note"`, `"scale"`, `"pat"`. Should match the ports' types (used for cable color). |
```

- [ ] **Step 3: SCHEMA.md — STEP ports** — find with `grep -n "^### STEP" SCHEMA.md`. The line:

```
- **inputs:** `clk` (clock) · **outputs:** `note` (note)
```

becomes:

```
- **inputs:** `clk` (clock), `pat` (pat) · **outputs:** `note` (note), `pat` (pat)
- A `pat` input applies `{steps, vel, gateLen, len}` onto this STEP
  immediately (same-tick pat deliveries apply before that tick's clk-driven
  step advance). The **SNAPSHOT** button emits this STEP's current params as
  a `pat` signal on its `pat` output.
```

(leave the rest of the STEP section — the `steps`/`vel`/`gateLen`/`len` params table — unchanged; `pat` carries exactly those existing params, nothing new to document there.)

- [ ] **Step 4: SCHEMA.md — new PATTRIG section** — find with `grep -n "^### EUCLID" SCHEMA.md`. Insert a new section immediately before it:

```
### PATTRIG  (pattern trigger — recall a STEP pattern by note)
- **inputs:** `note` (note), `pat` (pat) · **outputs:** `pat` (pat)
- A table of `{note, pat}` rows. On `note`: if the pitch is a key in the
  table, re-emits the stored `pat` immediately (always allowed, regardless
  of `locked`). If the pitch is unseen: ignored if `locked` or if no `pat`
  has been received yet (`held === null`); otherwise captures a new row
  `{note: pitch, pat: held}` and emits it — debounced to at most one new
  capture per second (`ev.time`-based) so a fast clock feeding `note` can't
  flood the table with a burst of unseen pitches.
- On `pat`: sample-and-holds into `held` (no output).
- **params:**
  | key      | type    | default | notes |
  |----------|---------|---------|-------|
  | `locked` | boolean | `false` | When true, unseen notes are ignored (no new captures); previously learned notes still recall. |
  | `held`   | object\|null | `null` | Last `pat.params` received on the `pat` input (sample-and-hold). `null` until the first `pat` arrives. |
  | `table`  | array   | `[]`    | `[{ note: 0-127, pat: {...} }, ...]`, insertion order. `pat` is a target module's `params` object (see PATTRIG signal type above). |

```

- [ ] **Step 5: README.md — new subsection** — find with `grep -n "^## Device remapping" README.md`. Insert a new subsection immediately before it:

```markdown
## Pattern recall (PATTRIG)

**PATTRIG** recalls a STEP pattern live by note — build a pattern on one
STEP, snapshot it into a PATTRIG's table, then trigger it later by pitch.

1. Build a pattern on an "editor" STEP.
2. Patch its `pat` output into a PATTRIG's `pat` input, and click that
   STEP's **SNAPSHOT** button — the PATTRIG's stoplight flips green.
3. Send the PATTRIG a note it hasn't seen (patch any note source into its
   `note` input) — it assigns the current held pattern to that pitch and
   plays it immediately. Repeat with a new pattern + a new note for each
   slot you want in the bank.
4. Click **LOCK** once the bank is built, so further stray notes can't add
   more rows (notes already learned still recall).
5. Patch the PATTRIG's `pat` output into a "player" STEP's `pat` input —
   sending a learned note now reconfigures that STEP's pattern live.

```

- [ ] **Step 6: Regression sweep**

Run: `<scratchpad>/run-smoke.sh <scratchpad>/pat-smoke.html` → `SMOKE: PASS`
Run the file:// boot check (background headless Chrome ~6s, grep stderr for `uncaught|syntaxerror|referenceerror`) → 0 hits:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless=new --disable-gpu --no-sandbox --enable-logging=stderr --v=1 \
  "file:///Users/tmoney/code/vibes/lambda-sequencer/index.html" \
  > /tmp/boot-stdout.log 2>/tmp/boot-stderr.log &
BOOT_PID=$!
sleep 6
kill "$BOOT_PID" 2>/dev/null
grep -Ei "uncaught|syntaxerror|referenceerror" /tmp/boot-stderr.log || echo "clean boot"
```

Check byte growth: `wc -c /Users/tmoney/code/vibes/lambda-sequencer/index.html` — expect ≤ ~4 KB over the pre-Task-2 size.

- [ ] **Step 7: Commit**

```bash
git add index.html SCHEMA.md README.md
git commit -m "$(cat <<'EOF'
Add PATTRIG: recall STEP patterns live by note

New pat signal type ({kind:'pat', time, params}) alongside
clock/note/scale, KIND_PRI'd between scale and note so a same-tick
pat swap applies before that tick's clk-driven step advance. STEP
gains pat in/out ports (withPat() wrapper + getPat/applyPat hooks)
and a SNAPSHOT button. PATTRIG is a note -> pat lookup table: hits
always recall; misses capture a new row (sample-and-hold from the
pat input), debounced to one new capture per second so a fast clock
feeding it can't flood the table. LOCK freezes the table; CLEAR
ALL / per-row [x] edit it.
EOF
)"
```

(The post-commit hook restamps the header hash and amends — normal.)

---

## Self-review notes

- **Spec coverage:** every spec section maps to a task — signal type + `KIND_PRI`/color (Task 2), `withPat`/STEP hooks/SNAPSHOT (Task 3), PATTRIG table logic (Task 4), PATTRIG UI (Task 5), docs (Task 6). All 8 numbered spec Testing scenarios are covered by harness groups (scenario 1→`G11`, 2→`G3`+integration, 3→`G9`, 4→`G6`, 5→`G8`, 6→`G12`, 7→`G13`, 8→`G14`/`G15`).
- **Type consistency:** `getPat`/`applyPat` names match between the `withPat()` contract (Task 3 Step 1), STEP's implementation (Task 3 Step 2), and `patSnapshotMixin`'s call site (Task 3 Step 3). PATTRIG's params shape (`locked`/`held`/`table`) is identical across `TYPES.PATTRIG.defaults()` (Task 4), the template's bindings (Task 5), and SCHEMA.md (Task 6).
- **`window` exposure fixed:** the harness was reworked to never reference `TYPES`/`SIGNAL_COLORS` directly (they're `const`s in a classic script, not `window` properties) — it drives everything through `app.emit`/`app.cables`/DOM instead, using a synthetic-source-object technique to inject events into arbitrary ports without needing a second real upstream module.
- **No placeholders:** every step has complete, pasteable code; no "add validation" or "similar to Task N" hand-waving.

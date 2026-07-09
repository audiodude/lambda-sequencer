# STEP Mute & Skip Implementation Plan

> **Status: COMPLETE (2026-07-09).** All tasks executed and verified (step-mode + marquee harnesses PASS, clean file:// boot, +3.2 KB). Feature commit: "STEP: per-step mute and skip states".

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** STEP steps gain two optional states — mute (note kept, silent, consumes its tick) and skip (playhead jumps past, consumes no time).

**Architecture:** One optional `mode: 'mute'|'skip'` field per step object; the clk handler advances past skipped steps with a one-lap guard; paint interactions gain Alt (mute) / Shift (skip) variants; three CSS cell states. Everything lives in `index.html` (single-file app).

**Tech Stack:** Vue 3 in-DOM/x-template components, headless-Chrome smoke harness (existing `run-smoke.sh` pattern).

Spec: `docs/superpowers/specs/2026-07-09-step-mute-skip-design.md`.

## Global Constraints

- Single-file app: all runtime code/CSS in `index.html`. Keep byte growth ≤ ~3 KB.
- Back-compat: pre-feature patches (no `mode` keys) load unchanged; patterns that never use the feature serialize with zero `mode` keys (use `delete s.mode`, never `s.mode = undefined` on live steps).
- Do NOT commit while `index.html` has unrelated in-progress edits — the post-commit hook (`hooks/post-commit`) blanket-runs `git add index.html` and amends.
- Never Read/cat whole `index.html` (contains 777 KB and 181 KB single lines); navigate with `grep -n` and short-range `sed -n`/Read offsets.
- `<component ... />` in-DOM caveat and other landmines: see `learnings.md` before editing templates.
- Harness verification runs via the session scratchpad's `run-smoke.sh <harness>.html` (serves scratchpad over :8437, headless Chrome, greps for `SMOKE:`). Exit 0 + `SMOKE: PASS` is the verdict.

---

### Task 1: Failing smoke harness (`step-mode-smoke.html`)

**Files:**
- Create: `<scratchpad>/step-mode-smoke.html` (test harness — scratchpad, not committed)

**Interfaces:**
- Consumes: `window.__SEQ` (app instance: `addModule(type,x,y)`, `modules`, `cables`, `emit(m,port,ev)`, `transport`, `serialize()`, `load(data)`), STEP DOM (`.module[data-mid] .cell`, `.labels .label`).
- Produces: the acceptance suite Tasks 2–3 must turn green. Tests reference step fields `s.on`, `s.pitch`, `s.mode` and CSS classes `mute`, `skip`, `noted`, `struck`.

- [x] **Step 1: Write the harness**

Same iframe pattern as `marquee-smoke.html`. Full content:

```html
<!doctype html>
<html>
<head><meta charset="utf-8"><title>step mode smoke</title></head>
<body>
<iframe id="f" src="index.html" style="width:1600px;height:900px;border:0"></iframe>
<script>
  const results = [];
  function check(name, cond, detail) {
    results.push({ name, ok: !!cond });
    console.log((cond ? 'ok  ' : 'FAIL') + ' - ' + name + (cond ? '' : ' :: ' + detail));
  }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function main() {
    const f = document.getElementById('f');
    const W = f.contentWindow;
    for (let i = 0; i < 200 && !(W.__SEQ && W.__SEQ.$refs && W.__SEQ.$refs.canvas); i++) await sleep(50);
    const app = W.__SEQ;
    if (!app) { console.log('SMOKE: FAIL (no __SEQ)'); return; }
    const doc = W.document;

    // fixture independence
    app.modules.length = 0;
    app.cables.length = 0;
    app.selectedModuleIds = [];
    await sleep(100);
    const clock = app.addModule('CLOCK', 20, 40);
    const step = app.addModule('STEP', 400, 40);
    app.cables.push({ from: { mid: clock.id, port: '1/16' }, to: { mid: step.id, port: 'clk' }, type: 'clock' });
    step.params.len = 8;
    await sleep(150);

    // spy on STEP note output
    const emit0 = app.emit.bind(app);
    const notes = [];
    app.emit = (m, port, ev) => {
      if (m.id === step.id && port === 'note') notes.push({ ...ev });
      return emit0(m, port, ev);
    };
    app.transport.playing = true;
    let T = 100;
    const tick = () => { T += 0.125; app.emit(clock, '1/16', { kind: 'clock', time: T, idx: 0, period: 0.125 }); };
    const S = step.params.steps;
    const reset = () => {
      for (let i = 0; i < S.length; i++) { S[i].on = false; S[i].pitch = 60; delete S[i].mode; }
      step.state.pos = -1;
      notes.length = 0;
    };

    // T1: playhead never lands on skipped steps; cycle shrinks to len - S
    reset();
    [0, 1, 3, 4, 6, 7].forEach((i) => { S[i].on = true; S[i].pitch = 60 + i; });
    S[2].mode = 'skip';           // empty skip
    S[5].mode = 'skip'; S[5].on = true; S[5].pitch = 99; // parked note skip
    const visited = [];
    for (let k = 0; k < 12; k++) { tick(); visited.push(step.state.pos); }
    check('T1 pos sequence skips 2 and 5',
      JSON.stringify(visited) === JSON.stringify([0, 1, 3, 4, 6, 7, 0, 1, 3, 4, 6, 7]),
      JSON.stringify(visited));
    check('T1 no note from parked step (pitch 99)', !notes.some((n) => n.pitch === 99), JSON.stringify(notes.map((n) => n.pitch)));
    check('T1 12 ticks -> 12 notes (2 full 6-step cycles, all on)', notes.length === 12, String(notes.length));

    // T2: muted step consumes its tick but emits nothing
    reset();
    [0, 1, 2, 3].forEach((i) => { S[i].on = true; S[i].pitch = 60 + i; });
    step.params.len = 4;
    S[1].mode = 'mute';
    for (let k = 0; k < 4; k++) tick();
    check('T2 mute consumed a tick (pos walked 0..3)', step.state.pos === 3, String(step.state.pos));
    check('T2 3 notes, pitch 61 absent',
      notes.length === 3 && !notes.some((n) => n.pitch === 61),
      JSON.stringify(notes.map((n) => n.pitch)));

    // T3: all skipped -> no notes, pos parks at -1, no hang
    reset();
    step.params.len = 4;
    [0, 1, 2, 3].forEach((i) => { S[i].mode = 'skip'; });
    for (let k = 0; k < 4; k++) tick();
    check('T3 all-skip: no notes', notes.length === 0, String(notes.length));
    check('T3 all-skip: pos -1', step.state.pos === -1, String(step.state.pos));

    // T4: UI interactions
    reset();
    step.params.len = 16;
    [0, 1, 2].forEach((i) => { S[i].on = true; S[i].pitch = 60 + i; });
    await sleep(100);
    const mEl = doc.querySelector(`.module[data-mid="${step.id}"]`);
    const cells = mEl.querySelectorAll('.cell');
    const pe = (type, el, opts = {}) =>
      el.dispatchEvent(new W.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, ...opts }));
    const clickCell = async (i, opts) => {
      pe('pointerdown', cells[i], opts);
      await sleep(20);
      W.dispatchEvent(new W.PointerEvent('pointerup', { bubbles: true }));
      await sleep(30);
    };

    await clickCell(0, { altKey: true });
    check('T4 alt+click mutes', S[0].mode === 'mute' && cells[0].classList.contains('mute'), JSON.stringify(S[0]));
    await clickCell(0, { altKey: true });
    check('T4 alt+click again unmutes', !S[0].mode && cells[0].classList.contains('on'), JSON.stringify(S[0]));
    await clickCell(1, { shiftKey: true });
    check('T4 shift+click skips (noted)', S[1].mode === 'skip' && cells[1].classList.contains('skip') && cells[1].classList.contains('noted'), JSON.stringify(S[1]));
    await clickCell(4, { shiftKey: true });
    check('T4 shift+click empty skips (no noted)', S[4].mode === 'skip' && !S[4].on && cells[4].classList.contains('skip') && !cells[4].classList.contains('noted'), JSON.stringify(S[4]));
    await clickCell(1, {});
    check('T4 plain click on skipped note -> plain off', !S[1].mode && !S[1].on, JSON.stringify(S[1]));
    check('T4 pitch survived mute/unmute round trip', S[0].pitch === 60, String(S[0].pitch));
    // alt on empty = no-op
    await clickCell(6, { altKey: true });
    check('T4 alt+click on empty is a no-op', !S[6].mode && !S[6].on, JSON.stringify(S[6]));
    // paint drag: alt-down on 2 (on), enter 3 (off, passed over), enter 0 (on)
    S[0].on = true; S[0].pitch = 60;
    await sleep(50);
    pe('pointerdown', cells[2], { altKey: true });
    await sleep(20);
    pe('pointerenter', cells[3]);
    await sleep(20);
    pe('pointerenter', cells[0]);
    await sleep(20);
    W.dispatchEvent(new W.PointerEvent('pointerup', { bubbles: true }));
    await sleep(30);
    check('T4 alt-paint muted 2 and 0, passed over empty 3',
      S[2].mode === 'mute' && S[0].mode === 'mute' && !S[3].mode && !S[3].on,
      JSON.stringify([S[0], S[2], S[3]]));
    // right-click clears everything
    cells[2].dispatchEvent(new W.MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await sleep(30);
    check('T4 right-click clears on+mode', !S[2].on && !S[2].mode, JSON.stringify(S[2]));
    // label strikethrough on muted step
    const labels = mEl.querySelectorAll('.labels .label');
    check('T4 muted label struck', labels[0].classList.contains('struck'), labels[0].className);

    // T5: serialization hygiene + legacy load
    reset();
    S[0].on = true; S[0].mode = 'mute'; delete S[0].mode;
    const ser = app.serialize();
    const stepSer = ser.modules.find((m) => m.id === step.id);
    check('T5 no mode keys after clearing', !JSON.stringify(stepSer.params.steps).includes('"mode"'), JSON.stringify(stepSer.params.steps[0]));
    app.load({
      bpm: 120, source: 'internal',
      modules: [{ id: 1, type: 'STEP', x: 10, y: 10, params: { len: 4, steps: [{ on: true, pitch: 62, vel: 100 }] }, disabled: {} }],
      cables: [],
    });
    await sleep(100);
    const legacy = app.modules.find((m) => m.type === 'STEP');
    check('T5 legacy patch loads, step normal', legacy && legacy.params.steps[0].on && !legacy.params.steps[0].mode, JSON.stringify(legacy && legacy.params.steps[0]));

    const bad = results.filter((r) => !r.ok);
    console.log(bad.length ? 'SMOKE: FAIL (' + bad.map((b) => b.name).join('; ') + ')' : 'SMOKE: PASS');
  }
  main().catch((e) => console.log('SMOKE: FAIL (exception: ' + (e && e.message) + ')'));
</script>
</body>
</html>
```

- [x] **Step 2: Run it — expect RED**

Run: `<scratchpad>/run-smoke.sh step-mode-smoke.html`
Expected: `SMOKE: FAIL` listing T1 (pos sequence includes 2/5), T3 (pos not -1), T4 (no mute class), etc. T2/T5 may partially pass (off-step silence and legacy load already work) — that's fine; the suite as a whole must FAIL.

No commit (harness lives in the scratchpad, outside the repo).

---

### Task 2: Playback semantics in `TYPES.STEP.onInput`

**Files:**
- Modify: `index.html` — `TYPES.STEP.onInput` (find with `grep -n "advance one step per incoming clock tick" index.html`; currently ~line 2610)

**Interfaces:**
- Consumes: step objects `{on, pitch, vel, mode?}` (Task 1's field contract).
- Produces: `m.state.pos` never equals a skipped index; `-1` when all of `len` is skipped; note emitted only when `step.on && step.mode !== 'mute'`.

- [x] **Step 1: Replace the advance/emit block**

The current tail of `onInput`:

```js
            m.state.pos = ((m.state.pos ?? -1) + 1) % m.params.len;
            const step = m.params.steps[m.state.pos];
            if (step && step.on) {
```

becomes:

```js
            // advance past skipped steps (they consume no clock tick). If every
            // step in len is skipped, play nothing and hide the playhead (-1)
            // instead of looping forever.
            let pos = m.state.pos ?? -1;
            let hops = 0;
            do {
              pos = (pos + 1) % m.params.len;
              hops++;
            } while (
              hops <= m.params.len &&
              (m.params.steps[pos] || {}).mode === 'skip'
            );
            if (hops > m.params.len) {
              m.state.pos = -1;
              return;
            }
            m.state.pos = pos;
            const step = m.params.steps[pos];
            if (step && step.on && step.mode !== 'mute') {
```

(the `ctx.emit(...)` body inside the `if` is unchanged)

- [x] **Step 2: Run harness — T1/T2/T3 green, T4 still red**

Run: `<scratchpad>/run-smoke.sh step-mode-smoke.html`
Expected: `SMOKE: FAIL` where every remaining FAIL line is a T4 UI check (no T1/T2/T3/T5 failures).

No commit yet (feature incomplete; single feature commit lands in Task 3).

---

### Task 3: UI — CSS, template bindings, paint interactions, rotate/×2, help

**Files:**
- Modify: `index.html` — STEP CSS block (~line 694 `.module.STEP .cell`), STEP template (`<template id="tmpl-step">`, ~line 1613), STEP component methods (`paintStart`/`applyPaint`/`clearStep`/`rotate`/`doubleLength`, ~line 3484)

**Interfaces:**
- Consumes: Task 2's playback contract; Task 1's class-name contract (`mute`, `skip`, `noted`, `struck`).
- Produces: complete user-facing feature; full harness green.

- [x] **Step 1: CSS — insert AFTER the `.module.STEP .cell.on` rule and BEFORE `.cell:hover`/`.cell.cur`** (so the `cur` inset ring still overrides on a muted cell):

```css
      .module.STEP .cell.mute {
        background: var(--bg2);
        border: 2px solid var(--note);
        opacity: 0.9;
      }
      .module.STEP .cell.skip {
        background: repeating-linear-gradient(45deg, var(--bg2) 0 4px, var(--line) 4px 7px);
        border: 1px dashed #3a4050;
        opacity: 0.7;
      }
      .module.STEP .cell.skip.noted {
        background: repeating-linear-gradient(45deg, var(--bg2) 0 4px, rgba(255, 216, 74, 0.38) 4px 7px);
        border-color: rgba(255, 216, 74, 0.45);
        opacity: 0.85;
      }
```

and next to `.labels .label.dim`:

```css
      .module.STEP .labels .label.struck {
        opacity: 0.5;
        text-decoration: line-through;
      }
```

- [x] **Step 2: Template class bindings** (in `#tmpl-step`)

Label div — add `struck`:

```
:class="['label', { on: s.on, dim: (ci*16 + j) >= module.params.len, editing: editIndex === (ci*16 + j), struck: s.on && !!s.mode }]"
```

Cell div — `on` only when unmoded; add the three state classes:

```
:class="['cell', { on: s.on && !s.mode, mute: s.mode === 'mute', skip: s.mode === 'skip', noted: s.mode === 'skip' && s.on, beat: j % 4 === 0, alt: (Math.floor(j / 4) + ci) % 2 === 1, tail: (ci*16 + j) === module.params.len - 1, cur: module.state.pos === (ci*16 + j) }]"
```

- [x] **Step 3: Paint machinery** (STEP component)

`data()` gains two fields:

```js
            painting: false,
            paintVal: false,
            paintKind: 'toggle', // 'toggle' (plain) | 'mode' (alt/shift)
            paintMode: null, // 'mute' | 'skip' | null=back-to-normal
```

`paintStart` — after the releasePointerCapture block, replace `this.paintVal = !this.module.params.steps[i].on;` with:

```js
            const s = this.module.params.steps[i];
            if (e.altKey) {
              if (!s.on) return; // mute only means something on a step with a note
              this.paintKind = 'mode';
              this.paintMode = s.mode === 'mute' ? null : 'mute';
            } else if (e.shiftKey) {
              this.paintKind = 'mode';
              this.paintMode = s.mode === 'skip' ? null : 'skip';
            } else {
              this.paintKind = 'toggle';
              this.paintVal = !s.on;
            }
```

`applyPaint` — replace whole body:

```js
          applyPaint(i) {
            const s = this.module.params.steps[i];
            if (this.paintKind === 'mode') {
              if (this.paintMode === 'mute' && !s.on) return; // pass over empty steps
              if ((s.mode || null) === this.paintMode) return;
              if (this.paintMode) s.mode = this.paintMode;
              else delete s.mode;
            } else {
              if (s.on === this.paintVal && !s.mode) return;
              if (this.paintVal && !s.on) s.pitch = this.lastPitch;
              s.on = this.paintVal;
              delete s.mode; // plain painting always yields plain steps
            }
            this.$emit('change');
          },
```

(Note: `if (this.paintVal && !s.on)` guards the pitch overwrite — plain-painting "on" across an already-on muted step unmutes it but keeps its pitch.)

`clearStep`:

```js
          clearStep(i) {
            const s = this.module.params.steps[i];
            s.on = false;
            delete s.mode;
            this.$emit('change');
          },
```

- [x] **Step 4: rotate / doubleLength carry `mode`**

In `doubleLength`, the `src.push(...)` line and the copy loop become:

```js
              src.push({ on: s.on, pitch: s.pitch, vel: s.vel, mode: s.mode });
```

```js
            for (let k = 0; k < newLen - oldLen; k++) {
              const t = steps[oldLen + k];
              t.on = src[k].on;
              t.pitch = src[k].pitch;
              t.vel = src[k].vel;
              if (src[k].mode) t.mode = src[k].mode;
              else delete t.mode;
            }
```

In `rotate`, the map and copy loop become:

```js
            const src = steps
              .slice(0, len)
              .map((s) => ({ on: s.on, pitch: s.pitch, vel: s.vel, mode: s.mode }));
            for (let k = 0; k < len; k++) {
              const t = steps[k];
              const o = src[(k + dir + len) % len];
              t.on = o.on;
              t.pitch = o.pitch;
              t.vel = o.vel;
              if (o.mode) t.mode = o.mode;
              else delete t.mode;
            }
```

(`Object.assign` is dropped in both: it can't REMOVE a stale `mode` from the target step.)

- [x] **Step 5: Help text** — in `#tmpl-step`'s `<template #help>`, after the "Right-click to clear…" sentence add:

```
          <b>Alt</b>-click mutes a step (note kept, silent, still takes its
          tick); <b>shift</b>-click skips it — the playhead jumps past, so it
          takes no time and the cycle shortens. Both paint across a drag.
```

- [x] **Step 6: Run full harness — expect GREEN**

Run: `<scratchpad>/run-smoke.sh step-mode-smoke.html`
Expected: `SMOKE: PASS`, exit 0.

No commit yet — commit lands with the docs in Task 4 so the feature ships as one coherent commit.

---

### Task 4: SCHEMA.md, regression sweep, commit

**Files:**
- Modify: `SCHEMA.md` (STEP section, ~line 97)
- Commit: `index.html`, `SCHEMA.md`

- [x] **Step 1: SCHEMA.md** — in the STEP `params` table, extend the `steps` row description and add a note. The row

```
  | `steps`   | array  | 16 × `{on:false,pitch:60,vel:100}` | Per-step `{ on:bool, pitch:0-127, vel:1-127 }`. (Step `vel` is currently unused; module `vel` is sent.) |
```

becomes:

```
  | `steps`   | array  | 16 × `{on:false,pitch:60,vel:100}` | Per-step `{ on:bool, pitch:0-127, vel:1-127, mode?:"mute"\|"skip" }`. `mode` is optional (absent = normal): `"mute"` keeps the note but plays nothing (still consumes its clock tick); `"skip"` makes the playhead jump past the step (consumes no tick, shortening the cycle). If every step within `len` is skipped, nothing plays. (Step `vel` is currently unused; module `vel` is sent.) |
```

- [x] **Step 2: Regression sweep**

Run: `<scratchpad>/run-smoke.sh step-mode-smoke.html` → `SMOKE: PASS`
Run: `<scratchpad>/run-smoke.sh marquee-smoke.html` → `SMOKE: PASS`
Run the file:// boot check (background headless Chrome 6 s, grep stderr for `uncaught|syntaxerror|referenceerror`) → 0 hits.
Check byte growth: `wc -c index.html` — expect ≤ ~3 KB over the pre-task size.

- [x] **Step 3: Commit**

```bash
git add index.html SCHEMA.md
git commit -m "STEP: per-step mute and skip states

Alt-click mutes (note kept, silent, consumes its tick); shift-click
skips (playhead jumps past, consumes no time). Both paint across a
drag. Optional per-step mode field; legacy patches unchanged."
```

(The post-commit hook restamps the header hash and amends — normal.)

# Unit Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Repeatable unit tests for λ-SEQ's music-theory helpers, module signal handlers, and patch serialization/migration — running the *shipped* `index.html` in headless Chromium, with no build step and no MIDI hardware.

**Architecture:** λ-SEQ is a single-file Vue 3 app; all logic lives in one classic `<script>` block in `index.html`, so its functions are script-scoped and unreachable from outside. We add one tiny production change: a frozen `window.__SEQ_TEST__` handle exposing the pure helpers and the `TYPES` module-definition table (the mounted app is already reachable via the existing `window.__SEQ` debug handle at `index.html:5312`). Tests are Playwright specs that load `index.html` via `file://` and call these functions with `page.evaluate()`. This tests the exact bytes that ship — no extraction, no copies — and follows the repo's own lesson that "headless Chrome catches what `node --check` doesn't" (`learnings.md`).

**Tech Stack:** `@playwright/test` (Chromium only), Node ≥ 20.11 (host has v20.20.2), npm. No other dependencies.

## Global Constraints

- The app MUST remain a single self-contained `index.html` with no build step (README: "Double-click/open `index.html` and go").
- The only production change allowed is the `window.__SEQ_TEST__` handle (Task 1). It must be side-effect-free, `Object.freeze`d, and must not alter runtime behavior. It will be included in EXPORT APP output (EXPORT serializes `document.documentElement.outerHTML`) — that is acceptable and intentional; do not try to strip it.
- Tests MUST NOT require MIDI hardware, audio output, or network access.
- Tests load the app via `file://` (README confirms the UI works on `file://`; WebMIDI may be unavailable there, which unit tests don't need).
- Do not touch the existing `window.__SEQ` handle or `.github/workflows/pages.yml`.
- Default branch is `main`. Work happens on branch `test/unit-tests` in worktree `.worktrees/unit-tests`.
- Note: a separate, broader attempt exists uncommitted in `.worktrees/automated-tests` (branch `test/automated-tests`) covering browser-UI/MIDI/audio regression. This plan is unit tests only; do not modify that worktree.

## Reference: code under test (all in `index.html`)

| What | Where |
|---|---|
| `ROOTS`, `SCALES` | `index.html:2248-2272` |
| `clamp`, `secondsPerPulse` | `index.html:2302-2310` |
| `midiToNoteName`, `parseNoteName` | `index.html:2523-2540` |
| `euclidPattern` | `index.html:2541-2554` |
| `quantize`, `scalePitches`, `buildChord` | `index.html:2555-2607` |
| `TYPES` (per-module `defaults()` + `onInput(ctx, m, port, ev)`) | `index.html:2612-2917` |
| `App.serialize()` / `App.load()` (incl. migrations) | `index.html:4906-4992` |
| `App.addModule()` (CLOCK/VIKTOR limits, DIV `ratio` migration, `nextId`) | `index.html:4088-4127` |
| End of app script (hook insertion point, after `tagPorts();`) | `index.html:5359` |

`onInput` handlers take `(ctx, m, port, ev)` where `ctx` is the App instance — but handlers only use `ctx.transport` (`{playing, bpm}`), `ctx.emit(m, port, ev)`, `ctx.midi.outputs` (a Map), and `ctx.activeNotes` (array). A plain fake object satisfies them, so module handlers are unit-testable without the app's cable graph.

---

### Task 1: Test infrastructure + `__SEQ_TEST__` hook

**Files:**
- Create: `package.json`
- Create: `playwright.config.mjs`
- Create: `tests/helpers.mjs`
- Create: `tests/smoke.spec.mjs`
- Modify: `index.html:5359` (insert hook after `tagPorts();`)
- Modify: `.gitignore`

**Interfaces:**
- Produces: `window.__SEQ_TEST__` — frozen object `{ clamp, secondsPerPulse, midiToNoteName, parseNoteName, euclidPattern, quantize, scalePitches, buildChord, ROOTS, SCALES, TYPES }` available on every booted page.
- Produces: `bootApp(page)` from `tests/helpers.mjs` — navigates to `index.html` via `file://`, waits for `__SEQ_TEST__` and `__SEQ`, and fails the test on any page error. Every later spec calls this in `beforeEach`.
- Produces: `runModule(page, opts)` from `tests/helpers.mjs` — one-shot module-handler harness (used by Tasks 3–4). Signature: `runModule(page, { type, params?, events })` → `Promise<{ emitted: {port, ev}[], state, params }>` where `events` is `[{port, ev}, ...]` fed to `TYPES[type].onInput` in order against a fake `ctx` with `transport = {playing: true, bpm: 120}`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "lambda-sequencer-tests",
  "private": true,
  "engines": { "node": ">=20.11" },
  "scripts": {
    "test": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.61.1"
  }
}
```

- [ ] **Step 2: Install dependencies and Chromium**

Run: `npm install && npx playwright install chromium`
Expected: `package-lock.json` created; Chromium downloads without error.

- [ ] **Step 3: Create `playwright.config.mjs`**

```js
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  reporter: 'list',
});
```

- [ ] **Step 4: Create `tests/helpers.mjs`**

```js
// Shared fixtures for the unit suite. The app is loaded via file:// —
// no server, no network — exactly like the double-click use case.
export const APP_URL = new URL('../index.html', import.meta.url).href;

// Boot the real app and fail fast on any uncaught page error
// (learnings.md: headless Chrome catches what node --check doesn't).
export async function bootApp(page) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  await page.goto(APP_URL);
  await page.waitForFunction(
    () => window.__SEQ_TEST__ != null && window.__SEQ != null,
  );
  if (errors.length) throw new Error('page errors on boot:\n' + errors.join('\n'));
}

// Drive one module's onInput handler against a fake ctx, entirely in-page.
// events: [{ port, ev }, ...] delivered in order.
// Returns { emitted, state, params } (JSON-serializable snapshots).
export function runModule(page, { type, params = {}, events }) {
  return page.evaluate(
    ({ type, params, events }) => {
      const def = window.__SEQ_TEST__.TYPES[type];
      const emitted = [];
      const ctx = {
        transport: { playing: true, bpm: 120 },
        emit: (m, port, ev) => emitted.push({ port, ev }),
      };
      const m = {
        id: 1,
        type,
        params: { ...def.defaults(), ...params },
        state: {},
        disabled: {},
      };
      for (const e of events) def.onInput(ctx, m, e.port, e.ev);
      return JSON.parse(JSON.stringify({ emitted, state: m.state, params: m.params }));
    },
    { type, params, events },
  );
}
```

- [ ] **Step 5: Write the failing smoke test — `tests/smoke.spec.mjs`**

```js
import { test, expect } from '@playwright/test';
import { bootApp } from './helpers.mjs';

test('app boots clean and exposes the test handle', async ({ page }) => {
  await bootApp(page);
  const shape = await page.evaluate(() => ({
    frozen: Object.isFrozen(window.__SEQ_TEST__),
    keys: Object.keys(window.__SEQ_TEST__).sort(),
    hasSeq: typeof window.__SEQ.serialize === 'function',
  }));
  expect(shape.frozen).toBe(true);
  expect(shape.keys).toEqual([
    'ROOTS', 'SCALES', 'TYPES',
    'buildChord', 'clamp', 'euclidPattern', 'midiToNoteName',
    'parseNoteName', 'quantize', 'scalePitches', 'secondsPerPulse',
  ]);
  expect(shape.hasSeq).toBe(true);
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `bootApp` times out in `waitForFunction` because `window.__SEQ_TEST__` doesn't exist yet.

- [ ] **Step 7: Add the hook to `index.html`**

At `index.html:5359`, directly after the final `tagPorts();` call and before the closing `</script>` (context shown; add only the marked lines):

```js
      const mo = new MutationObserver(() => tagPorts());
      mo.observe(document.querySelector('#app'), {
        childList: true,
        subtree: true,
      });
      tagPorts();

      // test handle — script-scoped pure helpers + module table, exposed for
      // the unit suite (tests/). Read-only; the app never consults this.
      window.__SEQ_TEST__ = Object.freeze({
        clamp,
        secondsPerPulse,
        midiToNoteName,
        parseNoteName,
        euclidPattern,
        quantize,
        scalePitches,
        buildChord,
        ROOTS,
        SCALES,
        TYPES,
      });
```

- [ ] **Step 8: Run test to verify it passes**

Run: `npm test`
Expected: PASS (1 test).

- [ ] **Step 9: Update `.gitignore`**

Append to `.gitignore`:

```
node_modules/
test-results/
playwright-report/
```

- [ ] **Step 10: Commit**

```bash
git add package.json package-lock.json playwright.config.mjs tests/helpers.mjs tests/smoke.spec.mjs index.html .gitignore
git commit -m "test: Playwright infrastructure + __SEQ_TEST__ handle"
```

---

### Task 2: Music-theory helper tests

**Files:**
- Create: `tests/helpers-fns.spec.mjs`

**Interfaces:**
- Consumes: `bootApp(page)` from `tests/helpers.mjs`; `window.__SEQ_TEST__.{clamp, secondsPerPulse, midiToNoteName, parseNoteName, euclidPattern, quantize, scalePitches, buildChord, SCALES}`.
- Produces: nothing consumed by later tasks.

All expected values below were hand-derived from the implementation at `index.html:2302-2607`; if one fails, suspect the test first, then read the source line range in the reference table.

- [ ] **Step 1: Write the tests — `tests/helpers-fns.spec.mjs`**

```js
import { test, expect } from '@playwright/test';
import { bootApp } from './helpers.mjs';

test.beforeEach(async ({ page }) => bootApp(page));

// Evaluate a __SEQ_TEST__ function by name with JSON args.
const call = (page, fn, ...args) =>
  page.evaluate(
    ({ fn, args }) => window.__SEQ_TEST__[fn](...args),
    { fn, args },
  );

test('clamp bounds values', async ({ page }) => {
  expect(await call(page, 'clamp', 5, 0, 10)).toBe(5);
  expect(await call(page, 'clamp', -1, 0, 10)).toBe(0);
  expect(await call(page, 'clamp', 11, 0, 10)).toBe(10);
});

test('secondsPerPulse is a 1/16 at the given bpm', async ({ page }) => {
  expect(await call(page, 'secondsPerPulse', 120)).toBeCloseTo(0.125);
  expect(await call(page, 'secondsPerPulse', 60)).toBeCloseTo(0.25);
});

test('midiToNoteName uses Ableton octaves (60 = C3)', async ({ page }) => {
  expect(await call(page, 'midiToNoteName', 60)).toBe('C3');
  expect(await call(page, 'midiToNoteName', 61)).toBe('C#3');
  expect(await call(page, 'midiToNoteName', 0)).toBe('C-2');
  expect(await call(page, 'midiToNoteName', 127)).toBe('G8');
  expect(await call(page, 'midiToNoteName', -1)).toBe('?');
  expect(await call(page, 'midiToNoteName', 128)).toBe('?');
});

test('parseNoteName round-trips names, accidentals, case', async ({ page }) => {
  expect(await call(page, 'parseNoteName', 'C3')).toBe(60);
  expect(await call(page, 'parseNoteName', 'f#2')).toBe(54);
  expect(await call(page, 'parseNoteName', 'Bb4')).toBe(82);
  expect(await call(page, 'parseNoteName', ' C3 ')).toBe(60); // trimmed
  expect(await call(page, 'parseNoteName', 'C-2')).toBe(0);
  expect(await call(page, 'parseNoteName', 'G8')).toBe(127);
});

test('parseNoteName rejects invalid and out-of-range input', async ({ page }) => {
  expect(await call(page, 'parseNoteName', 'H3')).toBe(null);
  expect(await call(page, 'parseNoteName', 'C')).toBe(null);   // octave required
  expect(await call(page, 'parseNoteName', '60')).toBe(null);
  expect(await call(page, 'parseNoteName', 'G#8')).toBe(null); // 128
  expect(await call(page, 'parseNoteName', 'Cb-2')).toBe(null); // -1
  expect(await call(page, 'parseNoteName', '')).toBe(null);
});

const idxOf = (pattern) =>
  pattern.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);

test('euclidPattern distributes hits', async ({ page }) => {
  expect(idxOf(await call(page, 'euclidPattern', 4, 16, 0))).toEqual([0, 4, 8, 12]);
  // NOTE: this implementation is floor(i*steps/hits), not true Bjorklund —
  // E(3,8) lands on [0,2,5] here (classic tresillo would be [0,3,6]).
  expect(idxOf(await call(page, 'euclidPattern', 3, 8, 0))).toEqual([0, 2, 5]);
  expect(idxOf(await call(page, 'euclidPattern', 8, 8, 0))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
});

test('euclidPattern edge cases: zero hits, clamped hits, rotation', async ({ page }) => {
  expect(await call(page, 'euclidPattern', 0, 8, 0)).toEqual(new Array(8).fill(false));
  // hits clamps to steps
  expect(idxOf(await call(page, 'euclidPattern', 5, 3, 0))).toEqual([0, 1, 2]);
  // rotation, incl. negative and > steps
  expect(idxOf(await call(page, 'euclidPattern', 1, 4, 1))).toEqual([1]);
  expect(idxOf(await call(page, 'euclidPattern', 1, 4, -1))).toEqual([3]);
  expect(idxOf(await call(page, 'euclidPattern', 1, 4, 5))).toEqual([1]);
});

test('quantize snaps to nearest scale tone (ties go down)', async ({ page }) => {
  const major = [0, 2, 4, 5, 7, 9, 11];
  // 61 (C#) is 1 away from both 60 and 62; strict < keeps the first (lower)
  expect(await call(page, 'quantize', 61, 0, major)).toBe(60);
  expect(await call(page, 'quantize', 60, 0, major)).toBe(60); // already in scale
  const pentMin = [0, 3, 5, 7, 10];
  expect(await call(page, 'quantize', 66, 0, pentMin)).toBe(65);
  // empty scale array passes pitch through
  expect(await call(page, 'quantize', 61, 0, [])).toBe(61);
});

test('scalePitches spans 0..127, sorted, root-shifted', async ({ page }) => {
  const cMajor = await call(page, 'scalePitches', 0, 'major');
  expect(cMajor[0]).toBe(0);
  expect(cMajor).toContain(60);
  expect(cMajor).not.toContain(61);
  expect(cMajor.every((n) => n >= 0 && n <= 127)).toBe(true);
  const sorted = [...cMajor].sort((a, b) => a - b);
  expect(cMajor).toEqual(sorted);
  // unknown scale name falls back to chromatic (128 pitches)
  const chroma = await call(page, 'scalePitches', 0, 'nope');
  expect(chroma.length).toBe(128);
});

test('buildChord stacks diatonic degrees', async ({ page }) => {
  // C major triad on C3
  expect(await call(page, 'buildChord', 60, 0, 'major', 'triad', 3, 0)).toEqual([60, 64, 67]);
  // diatonic triad on D is minor: D-F-A
  expect(await call(page, 'buildChord', 62, 0, 'major', 'triad', 3, 0)).toEqual([62, 65, 69]);
  // 7th
  expect(await call(page, 'buildChord', 60, 0, 'major', '7th', 4, 0)).toEqual([60, 64, 67, 71]);
  // sus2 / sus4
  expect(await call(page, 'buildChord', 60, 0, 'major', 'sus2', 3, 0)).toEqual([60, 62, 67]);
  expect(await call(page, 'buildChord', 60, 0, 'major', 'sus4', 3, 0)).toEqual([60, 65, 67]);
});

test('buildChord voices, inversion, edges', async ({ page }) => {
  // voices trims the recipe
  expect(await call(page, 'buildChord', 60, 0, 'major', 'triad', 2, 0)).toEqual([60, 64]);
  // first inversion rotates the bass up an octave
  expect(await call(page, 'buildChord', 60, 0, 'major', 'triad', 3, 1)).toEqual([64, 67, 72]);
  // off-scale input quantizes first (61 → 60)
  expect(await call(page, 'buildChord', 61, 0, 'major', 'triad', 3, 0)).toEqual([60, 64, 67]);
  // near the top of the range, out-of-range voices are dropped
  const top = await call(page, 'buildChord', 126, 0, 'major', 'triad', 3, 0);
  expect(top.every((n) => n <= 127)).toBe(true);
  // null pitch → empty
  expect(await call(page, 'buildChord', null, 0, 'major', 'triad', 3, 0)).toEqual([]);
});
```

- [ ] **Step 2: Run the new spec**

Run: `npx playwright test tests/helpers-fns.spec.mjs`
Expected: PASS (11 tests). If an expected value fails, re-derive it from the source before changing the assertion — the source line ranges are in the reference table.

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS (12 tests).

- [ ] **Step 4: Commit**

```bash
git add tests/helpers-fns.spec.mjs
git commit -m "test: music-theory helper unit tests"
```

---

### Task 3: Sequencing module handlers (STEP, EUCLID, DIV, TRANSPOSE)

**Files:**
- Create: `tests/modules-seq.spec.mjs`

**Interfaces:**
- Consumes: `bootApp(page)`, `runModule(page, {type, params, events})` from `tests/helpers.mjs` (Task 1). A clock event is `{kind:'clock', time:<sec>, idx:<n>, period:<sec>}`; a note event is `{kind:'note', time, pitch, vel, gateLen}`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the tests — `tests/modules-seq.spec.mjs`**

```js
import { test, expect } from '@playwright/test';
import { bootApp, runModule } from './helpers.mjs';

test.beforeEach(async ({ page }) => bootApp(page));

const clk = (time, idx, period = 0.125) => ({
  port: 'clk',
  ev: { kind: 'clock', time, idx, period },
});
const ticks = (n) => Array.from({ length: n }, (_, i) => clk(i * 0.125, i));

// STEP defaults: 16 steps all off, vel 100, gateLen 0.5, len 16
const stepOn = (pitch) => ({ on: true, pitch, vel: 100 });
const stepOff = () => ({ on: false, pitch: 60, vel: 100 });

test('STEP emits active steps with module vel and scaled gate', async ({ page }) => {
  const steps = [stepOn(60), stepOn(62), stepOff(), stepOn(65)];
  const { emitted } = await runModule(page, {
    type: 'STEP',
    params: { steps, len: 4 },
    events: ticks(4),
  });
  expect(emitted.map((e) => e.ev.pitch)).toEqual([60, 62, 65]);
  expect(emitted[0].port).toBe('note');
  expect(emitted[0].ev.vel).toBe(100); // module vel, not step vel
  // first pulse: no prior tick, gate = gateLen * ev.period = 0.5 * 0.125
  expect(emitted[0].ev.gateLen).toBeCloseTo(0.0625);
});

test('STEP does nothing when transport is stopped', async ({ page }) => {
  const out = await page.evaluate(() => {
    const def = window.__SEQ_TEST__.TYPES.STEP;
    const emitted = [];
    const ctx = { transport: { playing: false, bpm: 120 }, emit: (m, p, ev) => emitted.push(ev) };
    const m = { id: 1, type: 'STEP', params: def.defaults(), state: {}, disabled: {} };
    def.onInput(ctx, m, 'clk', { kind: 'clock', time: 0, idx: 0, period: 0.125 });
    return { emitted, pos: m.state.pos };
  });
  expect(out.emitted).toEqual([]);
  expect(out.pos).toBeUndefined(); // playhead did not advance
});

test('STEP mute consumes its tick but plays nothing', async ({ page }) => {
  const steps = [stepOn(60), { ...stepOn(62), mode: 'mute' }, stepOn(64), stepOff()];
  const { emitted, state } = await runModule(page, {
    type: 'STEP',
    params: { steps, len: 4 },
    events: ticks(3),
  });
  // tick 2 landed on the muted step (silent), tick 3 on step 2
  expect(emitted.map((e) => e.ev.pitch)).toEqual([60, 64]);
  expect(state.pos).toBe(2);
});

test('STEP skip consumes no tick (shortens the cycle)', async ({ page }) => {
  const steps = [stepOn(60), { ...stepOn(62), mode: 'skip' }, stepOn(64), stepOn(65)];
  const { emitted } = await runModule(page, {
    type: 'STEP',
    params: { steps, len: 4 },
    events: ticks(4),
  });
  // playhead visits 0, 2, 3, 0 — step 1 is jumped over
  expect(emitted.map((e) => e.ev.pitch)).toEqual([60, 64, 65, 60]);
});

test('STEP with every step skipped parks the playhead, no infinite loop', async ({ page }) => {
  const steps = Array.from({ length: 4 }, () => ({ ...stepOn(60), mode: 'skip' }));
  const { emitted, state } = await runModule(page, {
    type: 'STEP',
    params: { steps, len: 4 },
    events: ticks(2),
  });
  expect(emitted).toEqual([]);
  expect(state.pos).toBe(-1);
});

test('STEP wraps at len and measures gate from real tick spacing', async ({ page }) => {
  const steps = [stepOn(60), stepOn(62), stepOff(), stepOff()];
  const { emitted } = await runModule(page, {
    type: 'STEP',
    params: { steps, len: 2, gateLen: 0.5 },
    events: ticks(4),
  });
  // len 2 → pitches 60,62,60,62
  expect(emitted.map((e) => e.ev.pitch)).toEqual([60, 62, 60, 62]);
  // from the 2nd tick on, stepDur is measured: 0.125s spacing → 0.0625 gate
  expect(emitted[1].ev.gateLen).toBeCloseTo(0.0625);
});

test('EUCLID fires on pattern hits and retunes from its pitch input', async ({ page }) => {
  // hits=4, steps=16 → hits at 0,4,8,12 (verified in Task 2)
  const events = [
    { port: 'pitch', ev: { kind: 'note', time: 0, pitch: 48, vel: 100, gateLen: 0.1 } },
    ...ticks(8),
  ];
  const { emitted, params } = await runModule(page, {
    type: 'EUCLID',
    params: { hits: 4, steps: 16, rot: 0 },
    events,
  });
  expect(params.pitch).toBe(48); // retuned by the pitch input
  expect(emitted.map((e) => e.ev.pitch)).toEqual([48, 48]); // positions 0 and 4
  expect(emitted[0].ev.vel).toBe(110); // default module vel
});

test('DIV divides: num=1 den=2 passes every 2nd pulse with doubled period', async ({ page }) => {
  const { emitted } = await runModule(page, {
    type: 'DIV',
    params: { num: 1, den: 2 },
    events: ticks(4),
  });
  expect(emitted.map((e) => e.ev.time)).toEqual([0, 0.25]);
  expect(emitted[0].port).toBe('clk');
  expect(emitted[0].ev.period).toBeCloseTo(0.25); // outPeriod = inPeriod * den/num
});

test('DIV multiplies: num=2 den=1 emits 2 spaced pulses per input pulse', async ({ page }) => {
  const { emitted } = await runModule(page, {
    type: 'DIV',
    params: { num: 2, den: 1 },
    events: ticks(2),
  });
  const times = emitted.map((e) => e.ev.time);
  expect(times.length).toBe(4);
  expect(times[0]).toBeCloseTo(0);
  expect(times[1]).toBeCloseTo(0.0625); // halfway through the 0.125 window
  expect(times[2]).toBeCloseTo(0.125);
  expect(times[3]).toBeCloseTo(0.1875);
  expect(emitted[0].ev.period).toBeCloseTo(0.0625);
});

test('TRANSPOSE shifts and clamps pitch', async ({ page }) => {
  const note = (pitch) => ({ port: 'in', ev: { kind: 'note', time: 0, pitch, vel: 100, gateLen: 0.1 } });
  const up = await runModule(page, { type: 'TRANSPOSE', params: { semis: 7 }, events: [note(60)] });
  expect(up.emitted[0].ev.pitch).toBe(67);
  expect(up.emitted[0].port).toBe('out');
  const clamped = await runModule(page, { type: 'TRANSPOSE', params: { semis: 7 }, events: [note(125)] });
  expect(clamped.emitted[0].ev.pitch).toBe(127);
  // non-note events on 'in' are ignored
  const noise = await runModule(page, { type: 'TRANSPOSE', params: { semis: 7 }, events: [clk(0, 0)] });
  expect(noise.emitted).toEqual([]);
});
```

- [ ] **Step 2: Run the new spec**

Run: `npx playwright test tests/modules-seq.spec.mjs`
Expected: PASS (10 tests).

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS (22 tests).

- [ ] **Step 4: Commit**

```bash
git add tests/modules-seq.spec.mjs
git commit -m "test: STEP/EUCLID/DIV/TRANSPOSE handler unit tests"
```

---

### Task 4: Note-processing module handlers (QUANT, CHORD, CHANCE, SCL, MIDIOUT)

**Files:**
- Create: `tests/modules-note.spec.mjs`

**Interfaces:**
- Consumes: `bootApp`, `runModule` from `tests/helpers.mjs`. A scale event is `{kind:'scale', root:<0-11>, scale:<name>}`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the tests — `tests/modules-note.spec.mjs`**

```js
import { test, expect } from '@playwright/test';
import { bootApp, runModule } from './helpers.mjs';

test.beforeEach(async ({ page }) => bootApp(page));

const note = (pitch, extra = {}) => ({
  port: 'in',
  ev: { kind: 'note', time: 0, pitch, vel: 100, gateLen: 0.1, ...extra },
});
const scl = (root, scale) => ({ port: 'scl', ev: { kind: 'scale', root, scale } });

test('QUANT snap mode quantizes to the received scale', async ({ page }) => {
  const { emitted } = await runModule(page, {
    type: 'QUANT',
    params: { mode: 'snap' },
    events: [scl(0, 'major'), note(61)],
  });
  expect(emitted.map((e) => e.ev.pitch)).toEqual([60]);
  expect(emitted[0].port).toBe('out');
});

test('QUANT defaults to C major with no scl connection', async ({ page }) => {
  const { emitted } = await runModule(page, {
    type: 'QUANT',
    params: { mode: 'snap' },
    events: [note(61)],
  });
  expect(emitted[0].ev.pitch).toBe(60);
});

test('QUANT filter mode drops out-of-scale notes, passes in-scale untouched', async ({ page }) => {
  const { emitted } = await runModule(page, {
    type: 'QUANT',
    params: { mode: 'filter' },
    events: [scl(0, 'major'), note(61), note(62)],
  });
  expect(emitted.map((e) => e.ev.pitch)).toEqual([62]);
});

test('CHORD emits one note event per chord voice', async ({ page }) => {
  const { emitted } = await runModule(page, {
    type: 'CHORD',
    params: { type: 'triad', voices: 3, inversion: 0 },
    events: [scl(0, 'major'), note(60)],
  });
  expect(emitted.map((e) => e.ev.pitch)).toEqual([60, 64, 67]);
  // each carries the source event's timing/vel
  expect(emitted.every((e) => e.ev.vel === 100 && e.ev.time === 0)).toBe(true);
});

test('CHANCE is deterministic at the extremes', async ({ page }) => {
  const many = Array.from({ length: 50 }, () => note(60));
  const always = await runModule(page, { type: 'CHANCE', params: { prob: 100 }, events: many });
  expect(always.emitted.length).toBe(50);
  const never = await runModule(page, { type: 'CHANCE', params: { prob: 0 }, events: many });
  expect(never.emitted.length).toBe(0);
});

test('SCL prime broadcasts its scale', async ({ page }) => {
  const out = await page.evaluate(() => {
    const def = window.__SEQ_TEST__.TYPES.SCL;
    const emitted = [];
    const ctx = { emit: (m, port, ev) => emitted.push({ port, ev }) };
    const m = { id: 1, type: 'SCL', params: { root: 2, scale: 'dorian' }, state: {}, disabled: {} };
    def.prime(ctx, m);
    return emitted;
  });
  expect(out).toEqual([{ port: 'scl', ev: { kind: 'scale', root: 2, scale: 'dorian' } }]);
});

test('MIDIOUT sends note-on/off pairs with channel, clamps, and gate timing', async ({ page }) => {
  const out = await page.evaluate(() => {
    const def = window.__SEQ_TEST__.TYPES.MIDIOUT;
    const sent = [];
    const fakePort = { send: (data, t) => sent.push({ data: [...data], t }) };
    const ctx = { midi: { outputs: new Map([['dev1', fakePort]]) }, activeNotes: [] };
    const m = {
      id: 1, type: 'MIDIOUT',
      params: { ...def.defaults(), deviceId: 'dev1', channel: 2 },
      state: {}, disabled: {},
    };
    def.onInput(ctx, m, 'in', { kind: 'note', time: 1, pitch: 60, vel: 100, gateLen: 0.5 });
    // vel clamps to 1..127; gateLen clamps to 0.01..4s
    def.onInput(ctx, m, 'in', { kind: 'note', time: 2, pitch: 61, vel: 0, gateLen: 10 });
    return { sent, active: ctx.activeNotes };
  });
  // channel 2 → status 0x91/0x81 (145/129); times are ms
  expect(out.sent[0]).toEqual({ data: [145, 60, 100], t: 1000 });
  expect(out.sent[1]).toEqual({ data: [129, 60, 0], t: 1500 });
  expect(out.sent[2]).toEqual({ data: [145, 61, 1], t: 2000 });
  expect(out.sent[3]).toEqual({ data: [129, 61, 0], t: 6000 });
  expect(out.active).toEqual([
    { deviceId: 'dev1', ch: 1, pitch: 60 },
    { deviceId: 'dev1', ch: 1, pitch: 61 },
  ]);
});

test('MIDIOUT with an unknown device sends nothing', async ({ page }) => {
  const out = await page.evaluate(() => {
    const def = window.__SEQ_TEST__.TYPES.MIDIOUT;
    const ctx = { midi: { outputs: new Map() }, activeNotes: [] };
    const m = {
      id: 1, type: 'MIDIOUT',
      params: { ...def.defaults(), deviceId: 'ghost', channel: 1 },
      state: {}, disabled: {},
    };
    def.onInput(ctx, m, 'in', { kind: 'note', time: 1, pitch: 60, vel: 100, gateLen: 0.5 });
    return ctx.activeNotes;
  });
  expect(out).toEqual([]);
});
```

- [ ] **Step 2: Run the new spec**

Run: `npx playwright test tests/modules-note.spec.mjs`
Expected: PASS (8 tests).

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS (30 tests).

- [ ] **Step 4: Commit**

```bash
git add tests/modules-note.spec.mjs
git commit -m "test: QUANT/CHORD/CHANCE/SCL/MIDIOUT handler unit tests"
```

---

### Task 5: Patch serialization, load, and migrations

**Files:**
- Create: `tests/patch.spec.mjs`

**Interfaces:**
- Consumes: `bootApp` from `tests/helpers.mjs`; the existing `window.__SEQ` app handle (`load(data)`, `serialize()`, `addModule(type)`, `modules`, `cables`). Patch JSON shape is documented in `SCHEMA.md`.
- Produces: nothing consumed by later tasks.

`load()` runs on the real app instance (it disposes Viktor runtimes, mutates the reactive module list, and schedules a debounced autosave) — that's fine; each Playwright test gets a fresh browser context, so no state leaks between tests.

- [ ] **Step 1: Write the tests — `tests/patch.spec.mjs`**

```js
import { test, expect } from '@playwright/test';
import { bootApp } from './helpers.mjs';

test.beforeEach(async ({ page }) => bootApp(page));

const loadAndSerialize = (page, patch) =>
  page.evaluate((p) => {
    window.__SEQ.load(p);
    return window.__SEQ.serialize();
  }, patch);

const MINIMAL = {
  bpm: 100,
  source: 'internal',
  zoom: 1.5,
  modules: [
    { id: 1, type: 'CLOCK', x: 20, y: 40, params: { mode: 'internal', bpm: 100 }, disabled: {} },
    { id: 2, type: 'STEP', x: 320, y: 40, params: { len: 4 }, disabled: { 'out:note': true } },
  ],
  cables: [
    { from: { mid: 1, port: '1/8' }, to: { mid: 2, port: 'clk' }, type: 'clock' },
  ],
};

test('load → serialize round-trips modules, cables, bpm, zoom, disabled', async ({ page }) => {
  const out = await loadAndSerialize(page, MINIMAL);
  expect(out.bpm).toBe(100);
  expect(out.zoom).toBe(1.5);
  expect(out.modules.map((m) => [m.id, m.type])).toEqual([[1, 'CLOCK'], [2, 'STEP']]);
  expect(out.modules[1].disabled).toEqual({ 'out:note': true });
  expect(out.cables).toEqual(MINIMAL.cables);
});

test('partial params are filled from type defaults', async ({ page }) => {
  const out = await loadAndSerialize(page, MINIMAL);
  const step = out.modules.find((m) => m.type === 'STEP');
  expect(step.params.len).toBe(4);        // provided
  expect(step.params.vel).toBe(100);      // default
  expect(step.params.gateLen).toBe(0.5);  // default
  expect(step.params.steps.length).toBe(16); // default array
});

test('legacy CLOCK "clk" output port is rewritten to "1/16"', async ({ page }) => {
  const patch = {
    ...MINIMAL,
    cables: [{ from: { mid: 1, port: 'clk' }, to: { mid: 2, port: 'clk' }, type: 'clock' }],
  };
  const out = await loadAndSerialize(page, patch);
  expect(out.cables[0].from.port).toBe('1/16');
});

test('legacy KEY modules are dropped along with their cables', async ({ page }) => {
  const patch = {
    ...MINIMAL,
    modules: [...MINIMAL.modules, { id: 9, type: 'KEY', x: 0, y: 0, params: {}, disabled: {} }],
    cables: [
      ...MINIMAL.cables,
      { from: { mid: 9, port: 'note' }, to: { mid: 2, port: 'clk' }, type: 'note' },
    ],
  };
  const out = await loadAndSerialize(page, patch);
  expect(out.modules.find((m) => m.type === 'KEY')).toBeUndefined();
  expect(out.cables).toEqual(MINIMAL.cables); // KEY's cable is gone too
});

test('unknown module types are skipped without crashing', async ({ page }) => {
  const patch = {
    ...MINIMAL,
    modules: [...MINIMAL.modules, { id: 9, type: 'WAT', x: 0, y: 0, params: {}, disabled: {} }],
  };
  const out = await loadAndSerialize(page, patch);
  expect(out.modules.length).toBe(2);
});

test('legacy top-level extClockInId migrates onto the CLOCK module', async ({ page }) => {
  const out = await loadAndSerialize(page, { ...MINIMAL, extClockInId: 'ext-42' });
  expect(out.modules.find((m) => m.type === 'CLOCK').params.extInId).toBe('ext-42');
});

test('legacy DIV ratio param becomes num/den', async ({ page }) => {
  const patch = {
    ...MINIMAL,
    modules: [...MINIMAL.modules, { id: 3, type: 'DIV', x: 0, y: 0, params: { ratio: 4 }, disabled: {} }],
  };
  const out = await loadAndSerialize(page, patch);
  const div = out.modules.find((m) => m.type === 'DIV');
  expect(div.params.num).toBe(1);
  expect(div.params.den).toBe(4);
});

test('zoom is clamped to 0.3–2 and defaults to 1', async ({ page }) => {
  expect((await loadAndSerialize(page, { ...MINIMAL, zoom: 5 })).zoom).toBe(2);
  expect((await loadAndSerialize(page, { ...MINIMAL, zoom: 0.01 })).zoom).toBe(0.3);
  const { zoom, ...noZoom } = MINIMAL;
  expect((await loadAndSerialize(page, noZoom)).zoom).toBe(1);
});

test('only one CLOCK survives a load; nextId resumes after accepted ids', async ({ page }) => {
  const patch = {
    ...MINIMAL,
    modules: [
      ...MINIMAL.modules,
      { id: 7, type: 'CLOCK', x: 0, y: 0, params: {}, disabled: {} }, // dup, rejected
    ],
  };
  const out = await page.evaluate((p) => {
    window.__SEQ.load(p);
    const added = window.__SEQ.addModule('DIV');
    return { types: window.__SEQ.modules.map((m) => m.type), newId: added.id };
  }, patch);
  expect(out.types.filter((t) => t === 'CLOCK').length).toBe(1);
  // addModule rejects the dup CLOCK before its nextId bookkeeping
  // (index.html:4091-4096 returns early), so id 7 does NOT advance nextId;
  // accepted ids are 1 and 2, so the next module gets id 3.
  expect(out.newId).toBe(3);
});
```

- [ ] **Step 2: Run the new spec**

Run: `npx playwright test tests/patch.spec.mjs`
Expected: PASS (9 tests).

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS (39 tests).

- [ ] **Step 4: Commit**

```bash
git add tests/patch.spec.mjs
git commit -m "test: patch serialize/load round-trip and migration unit tests"
```

---

### Task 6: CI workflow + documentation

**Files:**
- Create: `.github/workflows/test.yml`
- Modify: `README.md` (add a Testing section after the Development section)

**Interfaces:**
- Consumes: `npm test` (Task 1). Nothing downstream.

- [ ] **Step 1: Create `.github/workflows/test.yml`**

```yaml
name: Unit tests

on:
  push:
    branches: [main]
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - run: npm test
```

- [ ] **Step 2: Add a Testing section to `README.md`**

Insert after the `## Development` section:

```markdown
## Testing

Unit tests run the shipped `index.html` in headless Chromium via Playwright —
no build step, no MIDI hardware. One-time setup, then run:

    npm install
    npx playwright install chromium
    npm test

The suite covers the music-theory helpers, every module's signal handler, and
patch save/load migrations. Test-only access to script-scoped functions goes
through the frozen `window.__SEQ_TEST__` handle at the bottom of `index.html`
(the mounted app itself is `window.__SEQ`). CI runs the suite on every push
and pull request (`.github/workflows/test.yml`).
```

- [ ] **Step 3: Verify the suite still passes locally**

Run: `npm test`
Expected: PASS (39 tests). (CI can only be verified after push; the workflow is intentionally identical to the local commands.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/test.yml README.md
git commit -m "test: CI workflow and README testing docs"
```

---

## Out of scope (deliberately)

- Browser-UI interaction tests (drag-patching, marquee, STEP cell gestures), WebMIDI stubbing/device-remap flows, EXPORT APP round-trips, and Viktor audio checks — the uncommitted `test/automated-tests` worktree already prototypes these; fold them in as a follow-up plan rather than duplicating here.
- CHANCE distribution testing beyond the deterministic 0/100 extremes (flaky by nature).
- The CLOCK scheduler / transport loop (wall-clock dependent; an integration concern).

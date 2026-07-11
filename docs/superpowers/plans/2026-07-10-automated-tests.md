# Full Automated Test Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full automated test suite for λ-SEQ — unit tests for music-theory helpers and module handlers, plus browser regression tests for device name-resolution/remapping, external MIDI clock, panic behavior, EXPORT APP, and STEP UI gestures — running the *shipped* `index.html` in headless Chromium with no build step and no MIDI hardware. Covers every assertion checklist in **GitHub issue #4** (manual test cycles 1–5).

**Architecture:** λ-SEQ is a single-file Vue 3 app; all logic lives in one classic `<script>` block in `index.html`, so its functions are script-scoped and unreachable from outside. We add one tiny production change: a frozen `window.__SEQ_TEST__` handle exposing the pure helpers, the `TYPES` module-definition table, and a `viktorRts` accessor (the mounted app is already reachable via the existing `window.__SEQ` debug handle at `index.html:5312`). Tests are Playwright specs served over a local static server; WebMIDI is stubbed via `addInitScript` *before* app scripts run — fake ports record every `send()`/`clear()` and can inject clock bytes, exactly the harness pattern documented in issue #4. This tests the exact bytes that ship — no extraction, no copies — and follows the repo's own lesson that "headless Chrome catches what `node --check` doesn't" (`learnings.md`).

**Tech Stack:** `@playwright/test` (two Chromium projects: `chromium` for everything, `audio` for Viktor with null audio output), Node ≥ 20.11 (host has v20.20.2), npm. No other dependencies.

## Global Constraints

- The app MUST remain a single self-contained `index.html` with no build step (README: "Double-click/open `index.html` and go").
- The only production change allowed is the `window.__SEQ_TEST__` handle (Task 1). It must be side-effect-free, `Object.freeze`d, and must not alter runtime behavior. It will be included in EXPORT APP output (EXPORT serializes `document.documentElement.outerHTML`) — that is acceptable and intentional; do not try to strip it.
- Tests MUST NOT require MIDI hardware, audio output, or network access. WebMIDI is always stubbed (`installAppStubs`), never real.
- Do not touch the existing `window.__SEQ` handle or `.github/workflows/pages.yml`.
- Default branch is `main`. Work happens on branch `test/unit-tests` in worktree `.worktrees/unit-tests`.
- Issue #4's Cycle-4 correction is binding: the Chrome rename-cache behavior itself (a real-browser/OS property needing a CoreMIDI helper) is explicitly OUT of scope for this suite; the stub suite covers add/remove `statechange` handling and name-resolution logic only.

## Prior art (read before starting)

- **GitHub issue #4** (`gh issue view 4 --comments`) — the manual test cycles this suite automates. Each browser-test task below names the cycle it implements.
- **`.worktrees/automated-tests`** (branch `test/automated-tests`, uncommitted) — an earlier prototype of this suite. Several specs below are adapted from it (they were validated against the issue #4 cycles), with fixes: its `audio.spec.mjs` referenced a `window.__VIKTOR()` global its own `index.html` diff never added, and its structural-edit test never actually had notes flowing. Do not build on that worktree; this plan is self-contained and supersedes it. Once this plan lands, that worktree can be deleted.

## Reference: code under test (all in `index.html`)

| What | Where |
|---|---|
| `ROOTS`, `SCALES` | `index.html:2248-2272` |
| `clamp`, `secondsPerPulse` | `index.html:2302-2310` |
| `viktorSharedEnsure` / `viktorEnsure` (runtime shape: `{engine, ctx, volumeNode, timers, sounding, loadedPatch}`), `viktorRts` map | `index.html:2322-2409` |
| `midiToNoteName`, `parseNoteName` | `index.html:2523-2540` |
| `euclidPattern` | `index.html:2541-2554` |
| `quantize`, `scalePitches`, `buildChord` | `index.html:2555-2607` |
| `TYPES` (per-module `defaults()` + `onInput(ctx, m, port, ev)`) | `index.html:2612-2917` |
| `DEFAULT_PATCH` (8 modules: CLOCK, 2×STEP, EUCLID, QUANT, 2×MIDIOUT, VIKTOR) | `index.html:2922-3296` |
| STEP paint gestures (`paintStart`: alt=mute, shift=skip; cell classes at 1693) | `index.html:3586-3641` |
| Device-map modal template (`.modal-row`, select, "Skip" / "Map devices" buttons) | `index.html:1382-1421` |
| Module root element carries `:data-mid="module.id"` | `index.html:1484-1485` |
| `App.addModule()` (CLOCK/VIKTOR limits, DIV `ratio` migration, `nextId`) | `index.html:4088-4127` |
| `App.emit()` / `drainEvents()` (disabled ports, event ordering) | `index.html:4312-4372` |
| `refreshMIDI` / `reconcileDevices` / `checkUnmappedDevices` / `applyDeviceMap` | `index.html:4431-4567` |
| `onMIDIMessage` (0xfa/0xf8/0xfc) / `onExtClockTick` (`TICKS_PER_PULSE` = 6) | `index.html:4569-4590` |
| `panic()` (CC123 + CC120 × 16 ch + `out.clear()`) | `index.html:4592-4608` |
| `App.serialize()` / `App.load()` (incl. migrations) | `index.html:4906-4992` |
| EXPORT APP (`saveStandalone`, bakes `__LAMBDA_BOOT_PATCH__`) | `index.html:5010-5047` |
| Boot precedence: boot patch > localStorage > default | `index.html:5277-5286` |
| End of app script (hook insertion point, after `tagPorts();`) | `index.html:5359` |

`onInput` handlers take `(ctx, m, port, ev)` where `ctx` is the App instance — but handlers only use `ctx.transport` (`{playing, bpm}`), `ctx.emit(m, port, ev)`, `ctx.midi.outputs` (a Map), and `ctx.activeNotes` (array). A plain fake object satisfies them, so module handlers are unit-testable without the app's cable graph.

---

### Task 1: Test infrastructure, WebMIDI stub harness, `__SEQ_TEST__` hook

**Files:**
- Create: `package.json`
- Create: `tests/server.mjs`
- Create: `playwright.config.mjs`
- Create: `tests/helpers.mjs`
- Create: `tests/smoke.spec.mjs`
- Modify: `index.html:5359` (insert hook after `tagPorts();`)
- Modify: `.gitignore`

**Interfaces:**
- Produces: `window.__SEQ_TEST__` — frozen object `{ clamp, secondsPerPulse, midiToNoteName, parseNoteName, euclidPattern, quantize, scalePitches, buildChord, ROOTS, SCALES, TYPES, viktorRts }` on every booted page (`viktorRts` is a zero-arg function returning the live module-id → Viktor-runtime Map).
- Produces: `installAppStubs(page, options)` from `tests/helpers.mjs` — installs, via `addInitScript` (runs before app scripts), a fake `navigator.requestMIDIAccess` whose outputs record all `send()`/`clear()` calls, plus optional boot patch / localStorage autosave / `Math.random` stub. Options: `{ inputs: [{id,name}], outputs: [{id,name}], bootPatch, savedPatch, random }`. Exposes in-page `window.__MIDI_TEST__ = { access, sent, clears, message(id, bytes), statechange() }`.
- Produces: `openApp(page, options)` — `installAppStubs` + `goto('/index.html')` + wait for `__SEQ`/`__SEQ_TEST__`/MIDI init; fails the test on any page or console error; returns the (empty) error list.
- Produces: `emptyPatch(modules?, cables?)` — minimal valid patch JSON.
- Produces: `runModule(page, { type, params?, events })` — one-shot module-handler harness (Tasks 3–4): feeds `events = [{port, ev}, ...]` to `TYPES[type].onInput` against a fake `ctx` (`transport = {playing: true, bpm: 120}`), returns `Promise<{emitted: {port, ev}[], state, params}>`.
- Produces: `APP_PATH` — absolute path of `index.html` (for the `file://` boot test in Task 10).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "lambda-sequencer-tests",
  "private": true,
  "engines": { "node": ">=20.11" },
  "scripts": {
    "test": "playwright test --project=chromium",
    "test:audio": "playwright test --project=audio",
    "test:all": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.61.1"
  }
}
```

- [ ] **Step 2: Install dependencies and Chromium**

Run: `npm install && npx playwright install chromium`
Expected: `package-lock.json` created; Chromium downloads without error.

- [ ] **Step 3: Create `tests/server.mjs`** (static server; `file://` can't serve `page.reload()` flows cleanly, and a served origin keeps localStorage keys stable at `lambda-seq-v1:/index.html`)

```js
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const types = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
};

createServer(async (req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new Error('Not a file');
    res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(8437, '127.0.0.1');
```

- [ ] **Step 4: Create `playwright.config.mjs`**

```js
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['line'], ['html', { open: 'never' }]] : 'line',
  timeout: 20_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: 'http://127.0.0.1:8437',
    trace: 'retain-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  webServer: {
    command: 'node tests/server.mjs',
    url: 'http://127.0.0.1:8437/index.html',
    reuseExistingServer: !process.env.CI,
    timeout: 10_000,
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: /audio\.spec\.mjs/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'audio',
      testMatch: /audio\.spec\.mjs/,
      use: {
        ...devices['Desktop Chrome'],
        launchOptions: {
          args: [
            '--autoplay-policy=no-user-gesture-required',
            '--disable-audio-output',
          ],
        },
      },
    },
  ],
});
```

- [ ] **Step 5: Create `tests/helpers.mjs`**

```js
import { resolve } from 'node:path';
import { expect } from '@playwright/test';

export const APP_PATH = resolve(import.meta.dirname, '..', 'index.html');

// Install WebMIDI stubs + boot state BEFORE any app script runs (issue #4
// harness pattern). Fake outputs record every send()/clear(); fake inputs
// accept injected bytes via window.__MIDI_TEST__.message(id, [0xf8]).
export async function installAppStubs(page, options = {}) {
  const config = {
    inputs: options.inputs || [],
    outputs: options.outputs || [],
    bootPatch: options.bootPatch || null,
    savedPatch: options.savedPatch || null,
    random: options.random,
  };
  await page.addInitScript((cfg) => {
    const sent = [];
    let clears = 0;
    const inputs = new Map(cfg.inputs.map(({ id, name }) => [id, {
      id, name, onmidimessage: null,
    }]));
    const outputs = new Map(cfg.outputs.map(({ id, name }) => [id, {
      id, name,
      send(data, timestamp) { sent.push({ id, data: Array.from(data), timestamp }); },
      clear() { clears++; },
    }]));
    const access = { inputs, outputs, onstatechange: null };
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: async () => access,
    });
    window.__MIDI_TEST__ = {
      access,
      sent,
      get clears() { return clears; },
      message(id, data) {
        const input = inputs.get(id);
        if (!input || !input.onmidimessage) throw new Error('MIDI input not ready: ' + id);
        input.onmidimessage({ data, target: input });
      },
      statechange() {
        if (access.onstatechange) access.onstatechange({ target: access });
      },
    };
    if (cfg.bootPatch) window.__LAMBDA_BOOT_PATCH__ = cfg.bootPatch;
    if (cfg.savedPatch)
      localStorage.setItem('lambda-seq-v1:' + location.pathname, JSON.stringify(cfg.savedPatch));
    if (cfg.random != null) Math.random = () => cfg.random;
  }, config);
}

// Boot the real app over the local server and fail fast on any page error
// (learnings.md: headless Chrome catches what node --check doesn't).
export async function openApp(page, options = {}) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await installAppStubs(page, options);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__SEQ != null && window.__SEQ_TEST__ != null);
  await page.waitForFunction(() => window.__SEQ.midi.access != null);
  expect(errors, 'no page errors on boot').toEqual([]);
  return errors;
}

export function emptyPatch(modules = [], cables = []) {
  return { bpm: 120, source: 'internal', zoom: 1, modules, cables };
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

- [ ] **Step 6: Write the failing smoke test — `tests/smoke.spec.mjs`**

```js
import { test, expect } from '@playwright/test';
import { openApp, emptyPatch } from './helpers.mjs';

test('app boots clean and exposes the test handle', async ({ page }) => {
  await openApp(page, { bootPatch: emptyPatch() });
  const shape = await page.evaluate(() => ({
    frozen: Object.isFrozen(window.__SEQ_TEST__),
    keys: Object.keys(window.__SEQ_TEST__).sort(),
    hasSeq: typeof window.__SEQ.serialize === 'function',
    viktorRtsIsMap: window.__SEQ_TEST__.viktorRts() instanceof Map,
  }));
  expect(shape.frozen).toBe(true);
  expect(shape.keys).toEqual([
    'ROOTS', 'SCALES', 'TYPES',
    'buildChord', 'clamp', 'euclidPattern', 'midiToNoteName',
    'parseNoteName', 'quantize', 'scalePitches', 'secondsPerPulse',
    'viktorRts',
  ]);
  expect(shape.hasSeq).toBe(true);
  expect(shape.viktorRtsIsMap).toBe(true);
});

test('the default patch boots with 8 modules and tagged ports', async ({ page }) => {
  await openApp(page); // no boot patch, fresh context → DEFAULT_PATCH
  await expect(page.locator('.module')).toHaveCount(8);
  await expect(
    page.locator('.module .port[data-mid][data-port][data-type]').first(),
  ).toBeVisible();
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — `openApp` times out waiting for `window.__SEQ_TEST__`, which doesn't exist yet.

- [ ] **Step 8: Add the hook to `index.html`**

At `index.html:5359`, directly after the final `tagPorts();` call and before the closing `</script>` (context shown; add only the marked lines):

```js
      const mo = new MutationObserver(() => tagPorts());
      mo.observe(document.querySelector('#app'), {
        childList: true,
        subtree: true,
      });
      tagPorts();

      // test handle — script-scoped pure helpers + module table + Viktor
      // runtime accessor, exposed for the automated suite (tests/).
      // Read-only; the app never consults this.
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
        viktorRts: () => viktorRts,
      });
```

- [ ] **Step 9: Run test to verify it passes**

Run: `npm test`
Expected: PASS (2 tests).

- [ ] **Step 10: Update `.gitignore`**

Append to `.gitignore`:

```
node_modules/
test-results/
playwright-report/
```

- [ ] **Step 11: Commit**

```bash
git add package.json package-lock.json playwright.config.mjs tests/server.mjs tests/helpers.mjs tests/smoke.spec.mjs index.html .gitignore
git commit -m "test: Playwright infrastructure, WebMIDI stub harness, __SEQ_TEST__ handle"
```

---

### Task 2: Music-theory helper unit tests

**Files:**
- Create: `tests/helpers-fns.spec.mjs`

**Interfaces:**
- Consumes: `openApp`, `emptyPatch` from `tests/helpers.mjs`; `window.__SEQ_TEST__.{clamp, secondsPerPulse, midiToNoteName, parseNoteName, euclidPattern, quantize, scalePitches, buildChord}`.
- Produces: nothing consumed by later tasks.

All expected values below were hand-derived from the implementation at `index.html:2302-2607`; if one fails, suspect the test first, then read the source line range in the reference table.

- [ ] **Step 1: Write the tests — `tests/helpers-fns.spec.mjs`**

```js
import { test, expect } from '@playwright/test';
import { openApp, emptyPatch } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await openApp(page, { bootPatch: emptyPatch() });
});

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

Run: `npx playwright test --project=chromium tests/helpers-fns.spec.mjs`
Expected: PASS (11 tests). If an expected value fails, re-derive it from the source before changing the assertion.

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS (13 tests).

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
- Consumes: `openApp`, `emptyPatch`, `runModule` from `tests/helpers.mjs`. A clock event is `{kind:'clock', time:<sec>, idx:<n>, period:<sec>}`; a note event is `{kind:'note', time, pitch, vel, gateLen}`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the tests — `tests/modules-seq.spec.mjs`**

```js
import { test, expect } from '@playwright/test';
import { openApp, emptyPatch, runModule } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await openApp(page, { bootPatch: emptyPatch() });
});

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

Run: `npx playwright test --project=chromium tests/modules-seq.spec.mjs`
Expected: PASS (10 tests).

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS (23 tests).

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
- Consumes: `openApp`, `emptyPatch`, `runModule` from `tests/helpers.mjs`. A scale event is `{kind:'scale', root:<0-11>, scale:<name>}`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the tests — `tests/modules-note.spec.mjs`**

```js
import { test, expect } from '@playwright/test';
import { openApp, emptyPatch, runModule } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await openApp(page, { bootPatch: emptyPatch() });
});

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

Run: `npx playwright test --project=chromium tests/modules-note.spec.mjs`
Expected: PASS (8 tests).

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS (31 tests).

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
- Consumes: `openApp`, `emptyPatch` from `tests/helpers.mjs`; the existing `window.__SEQ` app handle (`load(data)`, `serialize()`, `addModule(type)`, `modules`, `cables`). Patch JSON shape is documented in `SCHEMA.md`.
- Produces: nothing consumed by later tasks.

`load()` runs on the real app instance (it disposes Viktor runtimes, mutates the reactive module list, and schedules a debounced autosave) — that's fine; each Playwright test gets a fresh browser context, so no state leaks between tests.

- [ ] **Step 1: Write the tests — `tests/patch.spec.mjs`**

```js
import { test, expect } from '@playwright/test';
import { openApp, emptyPatch } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await openApp(page, { bootPatch: emptyPatch() });
});

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

Run: `npx playwright test --project=chromium tests/patch.spec.mjs`
Expected: PASS (9 tests).

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS (40 tests).

- [ ] **Step 4: Commit**

```bash
git add tests/patch.spec.mjs
git commit -m "test: patch serialize/load round-trip and migration unit tests"
```

---

### Task 6: Rack behavior — module limits, event ordering, disabled ports

**Files:**
- Create: `tests/rack.spec.mjs`

**Interfaces:**
- Consumes: `openApp`, `emptyPatch` from `tests/helpers.mjs`; `window.__SEQ.{addModule, duplicateModule, removeModule, cables, emit, fireMasterPulse, transport}`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the tests — `tests/rack.spec.mjs`**

```js
import { test, expect } from '@playwright/test';
import { openApp, emptyPatch } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await openApp(page, { bootPatch: emptyPatch() });
});

test('module limits are enforced and duplication deep-copies params', async ({ page }) => {
  const result = await page.evaluate(() => {
    const app = window.__SEQ;
    const clock1 = app.addModule('CLOCK', 10, 10);
    const clock2 = app.addModule('CLOCK', 20, 20); // rejected → returns existing
    const step = app.addModule('STEP', 30, 30);
    step.params.steps[0].on = true;
    app.duplicateModule(step.id);
    const copy = app.modules.find((m) => m.type === 'STEP' && m.id !== step.id);
    copy.params.steps[0].pitch = 99; // must not leak into the original
    const viktors = Array.from({ length: 5 }, () => app.addModule('VIKTOR', 0, 0));
    return {
      clocks: app.modules.filter((m) => m.type === 'CLOCK').length,
      sameClock: clock1.id === clock2.id,
      viktors: app.modules.filter((m) => m.type === 'VIKTOR').length,
      fifthReturnedExisting: viktors[4].id === viktors[3].id,
      originalPitch: step.params.steps[0].pitch,
      copiedPitch: copy.params.steps[0].pitch,
    };
  });
  expect(result).toEqual({
    clocks: 1,
    sameClock: true,
    viktors: 4,
    fifthReturnedExisting: true,
    originalPitch: 60,
    copiedPitch: 99,
  });
});

test('same-time modulation settles before the consumer clock fires', async ({ page }) => {
  // STEP note → EUCLID pitch, both clocked by the same pulse: drainEvents
  // must deliver the retune BEFORE euclid's clock tick (index.html:4325-4372),
  // so euclid's first hit already carries the modulated pitch.
  const pitches = await page.evaluate(() => {
    const app = window.__SEQ;
    const clock = app.addModule('CLOCK', 0, 0);
    const step = app.addModule('STEP', 0, 0);
    const euclid = app.addModule('EUCLID', 0, 0);
    step.params.steps[0].on = true;
    step.params.steps[0].pitch = 72;
    euclid.params.hits = 1;
    euclid.params.steps = 1;
    app.cables.push(
      { from: { mid: clock.id, port: '1/16' }, to: { mid: step.id, port: 'clk' }, type: 'clock' },
      { from: { mid: clock.id, port: '1/16' }, to: { mid: euclid.id, port: 'clk' }, type: 'clock' },
      { from: { mid: step.id, port: 'note' }, to: { mid: euclid.id, port: 'pitch' }, type: 'note' },
    );
    const emitted = [];
    const original = app.emit.bind(app);
    app.emit = (m, port, event) => {
      if (m.id === euclid.id && port === 'note') emitted.push(event.pitch);
      return original(m, port, event);
    };
    app.transport.playing = true;
    app.fireMasterPulse(100, 0);
    app.transport.playing = false;
    return emitted;
  });
  expect(pitches).toEqual([72]);
});

test('disabled ports stop signals without removing cables', async ({ page }) => {
  const result = await page.evaluate(() => {
    const app = window.__SEQ;
    const source = app.addModule('TRANSPOSE', 0, 0);
    const target = app.addModule('TRANSPOSE', 0, 0);
    app.cables.push({ from: { mid: source.id, port: 'out' }, to: { mid: target.id, port: 'in' }, type: 'note' });
    const seen = [];
    const original = app.emit.bind(app);
    app.emit = (m, port, event) => {
      if (m.id === target.id && port === 'out') seen.push(event.pitch);
      return original(m, port, event);
    };
    target.disabled['in:in'] = true;
    app.emit(source, 'out', { kind: 'note', time: 1, pitch: 60, vel: 100, gateLen: 0.1 });
    delete target.disabled['in:in'];
    app.emit(source, 'out', { kind: 'note', time: 2, pitch: 61, vel: 100, gateLen: 0.1 });
    return { seen, cables: app.cables.length };
  });
  expect(result).toEqual({ seen: [61], cables: 1 });
});
```

- [ ] **Step 2: Run the new spec**

Run: `npx playwright test --project=chromium tests/rack.spec.mjs`
Expected: PASS (3 tests).

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS (43 tests).

- [ ] **Step 4: Commit**

```bash
git add tests/rack.spec.mjs
git commit -m "test: module limits, event ordering, disabled ports"
```

---

### Task 7: Device name-resolution and the mapping modal (issue #4, cycles 1, 3, 4)

**Files:**
- Create: `tests/devices.spec.mjs`

**Interfaces:**
- Consumes: `openApp`, `emptyPatch` from `tests/helpers.mjs` (incl. the `savedPatch` option); `window.__MIDI_TEST__.statechange()`; the modal at `index.html:1382-1421` (rows `.modal-row`, per-row `<select>`, buttons named "Skip" / "Map devices").
- Produces: nothing consumed by later tasks (Task 8 rebuilds its own CLOCK-ext wiring).

- [ ] **Step 1: Write the tests — `tests/devices.spec.mjs`**

```js
import { test, expect } from '@playwright/test';
import { emptyPatch, openApp } from './helpers.mjs';

// One name wanted by THREE modules across both kinds: a CLOCK external-clock
// input and two MIDI OUT outputs (issue #4 cycle 3's exact scenario).
const portablePatch = emptyPatch([
  { id: 1, type: 'CLOCK', x: 0, y: 0, params: { mode: 'ext', extInId: '', extInName: 'IAC Bus' }, disabled: {} },
  { id: 2, type: 'MIDIOUT', x: 0, y: 0, params: { deviceId: '', deviceName: 'IAC Bus', channel: 1 }, disabled: {} },
  { id: 3, type: 'MIDIOUT', x: 0, y: 0, params: { deviceId: '', deviceName: 'IAC Bus', channel: 2 }, disabled: {} },
]);

test('portable device names resolve silently when present (cycle 1)', async ({ page }) => {
  await openApp(page, {
    bootPatch: portablePatch,
    inputs: [{ id: 'in-iac', name: 'IAC Bus' }],
    outputs: [{ id: 'out-iac', name: 'IAC Bus' }],
  });
  const params = await page.evaluate(() =>
    window.__SEQ.modules.map((m) => ({ ...m.params })));
  expect(params[0].extInId).toBe('in-iac');   // clock bound to the INPUT port
  expect(params[1].deviceId).toBe('out-iac'); // outs bound to the OUTPUT port
  expect(params[2].deviceId).toBe('out-iac');
  await expect(page.locator('.modal')).toHaveCount(0);
});

test('absent name groups into one row and Map remaps every member (cycle 3)', async ({ page }) => {
  await openApp(page, {
    bootPatch: portablePatch,
    inputs: [{ id: 'in-m2', name: 'M2' }],
    outputs: [{ id: 'out-m2', name: 'M2' }],
  });
  await expect(page.locator('.modal')).toBeVisible();
  await expect(page.locator('.modal-row')).toHaveCount(1); // grouped by name
  const group = await page.evaluate(() => {
    const it = window.__SEQ.deviceMapPrompt.items[0];
    return { name: it.wantedName, kinds: [...it.kinds].sort(), members: it.members.length };
  });
  expect(group).toEqual({ name: 'IAC Bus', kinds: ['in', 'out'], members: 3 });

  // drive the REAL modal UI, not the method
  await page.locator('.modal-row select').selectOption('M2');
  await page.getByRole('button', { name: 'Map devices' }).click();
  await expect(page.locator('.modal')).toHaveCount(0);

  // every member remapped, each to a port of its own kind
  const modules = await page.evaluate(() => window.__SEQ.serialize().modules.map((m) => m.params));
  expect(modules[0]).toMatchObject({ extInId: 'in-m2', extInName: 'M2' });
  expect(modules[1]).toMatchObject({ deviceId: 'out-m2', deviceName: 'M2' });
  expect(modules[2]).toMatchObject({ deviceId: 'out-m2', deviceName: 'M2' });

  // persistence: the debounced autosave lands in localStorage
  await expect.poll(() => page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem('lambda-seq-v1:' + location.pathname) || 'null');
    return saved?.modules?.[0]?.params?.extInName;
  })).toBe('M2');
});

test('a saved remapped patch reloads fully bound with no modal (cycle 3 reload)', async ({ page }) => {
  // simulate the post-remap state: autosave carries M2 names; boot from localStorage
  const remapped = emptyPatch([
    { id: 1, type: 'CLOCK', x: 0, y: 0, params: { mode: 'ext', extInId: 'stale', extInName: 'M2' }, disabled: {} },
    { id: 2, type: 'MIDIOUT', x: 0, y: 0, params: { deviceId: 'stale', deviceName: 'M2', channel: 1 }, disabled: {} },
  ]);
  await openApp(page, {
    savedPatch: remapped, // no bootPatch → localStorage wins (index.html:5284)
    inputs: [{ id: 'in-m2', name: 'M2' }],
    outputs: [{ id: 'out-m2', name: 'M2' }],
  });
  const params = await page.evaluate(() => window.__SEQ.modules.map((m) => ({ ...m.params })));
  expect(params[0]).toMatchObject({ extInId: 'in-m2', extInName: 'M2' });
  expect(params[1]).toMatchObject({ deviceId: 'out-m2', deviceName: 'M2' });
  await expect(page.locator('.modal')).toHaveCount(0);
});

test('Skip leaves devices unmapped and the prompt re-offers on device change (nag-every-time)', async ({ page }) => {
  await openApp(page, {
    bootPatch: portablePatch,
    inputs: [{ id: 'in-m2', name: 'M2' }],
    outputs: [{ id: 'out-m2', name: 'M2' }],
  });
  await expect(page.locator('.modal')).toBeVisible();
  await page.getByRole('button', { name: 'Skip' }).click();
  await expect(page.locator('.modal')).toHaveCount(0);
  await page.evaluate(() => window.__MIDI_TEST__.statechange()); // device list changes
  await expect(page.locator('.modal')).toBeVisible(); // no suppression memory
});

test('a still-valid port id refreshes a stale stored name — live port wins (cycle 4)', async ({ page }) => {
  const patch = emptyPatch([
    { id: 1, type: 'MIDIOUT', x: 0, y: 0, params: { deviceId: 'same-id', deviceName: 'Old Name', channel: 1 }, disabled: {} },
  ]);
  await openApp(page, {
    bootPatch: patch,
    outputs: [{ id: 'same-id', name: 'Renamed Synth' }],
  });
  const params = await page.evaluate(() => ({ ...window.__SEQ.modules[0].params }));
  expect(params).toMatchObject({ deviceId: 'same-id', deviceName: 'Renamed Synth' });
  await expect(page.locator('.modal')).toHaveCount(0);
  // display source: a dropdown option shows the LIVE port name, never the
  // stored one (don't assume which of the module's selects is the device one)
  await expect(
    page.locator('.module.MIDIOUT select', { hasText: 'Renamed Synth' }),
  ).toHaveCount(1);
});

test('no prompt when the machine has no ports of the wanted kind', async ({ page }) => {
  await openApp(page, { bootPatch: portablePatch }); // zero inputs & outputs
  await expect(page.locator('.modal')).toHaveCount(0); // nothing to map onto
});
```

- [ ] **Step 2: Run the new spec**

Run: `npx playwright test --project=chromium tests/devices.spec.mjs`
Expected: PASS (6 tests).

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS (49 tests).

- [ ] **Step 4: Commit**

```bash
git add tests/devices.spec.mjs
git commit -m "test: device name-resolution, grouped remap modal, rename refresh (issue #4 cycles 1/3/4)"
```

---

### Task 8: External clock, signal flow, and panic discipline (issue #4, cycles 2, 5)

**Files:**
- Create: `tests/clock-panic.spec.mjs`

**Interfaces:**
- Consumes: `openApp`, `emptyPatch` from `tests/helpers.mjs`; `window.__MIDI_TEST__.{message, sent, clears}`; `demos/melodic-arp-chords.json` (5 MIDIOUTs on channels 1,2,3,4,10; one CHANCE at prob 80). MIDI realtime bytes: `0xfa` start, `0xf8` tick (6 ticks per 1/16 pulse — `TICKS_PER_PULSE`), `0xfc` stop.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the tests — `tests/clock-panic.spec.mjs`**

```js
import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { emptyPatch, openApp } from './helpers.mjs';

const demoPatch = JSON.parse(
  await readFile(new URL('../demos/melodic-arp-chords.json', import.meta.url)),
);

const extPatch = (extra = [], extraCables = []) => emptyPatch([
  { id: 1, type: 'CLOCK', x: 0, y: 0, params: { mode: 'ext', extInId: 'clock-in', extInName: 'Clock' }, disabled: {} },
  { id: 2, type: 'STEP', x: 0, y: 0, params: { len: 1, steps: [{ on: true, pitch: 64, vel: 100 }] }, disabled: {} },
  { id: 3, type: 'MIDIOUT', x: 0, y: 0, params: { deviceId: 'synth-out', deviceName: 'Synth', channel: 3 }, disabled: {} },
  ...extra,
], [
  { from: { mid: 1, port: '1/16' }, to: { mid: 2, port: 'clk' }, type: 'clock' },
  { from: { mid: 2, port: 'note' }, to: { mid: 3, port: 'in' }, type: 'note' },
  ...extraCables,
]);

const stubDevices = {
  inputs: [{ id: 'clock-in', name: 'Clock' }],
  outputs: [{ id: 'synth-out', name: 'Synth' }],
};

test('external clock fires the downbeat on the FIRST tick; stop panics (cycles 2+5)', async ({ page }) => {
  await openApp(page, { bootPatch: extPatch(), ...stubDevices });
  const result = await page.evaluate(() => {
    window.__MIDI_TEST__.message('clock-in', [0xfa]); // start
    window.__MIDI_TEST__.message('clock-in', [0xf8]); // first tick = downbeat
    const afterFirstTick = window.__MIDI_TEST__.sent.map((m) => m.data);
    window.__MIDI_TEST__.message('clock-in', [0xfc]); // stop
    return {
      afterFirstTick,
      all: window.__MIDI_TEST__.sent.map((m) => m.data),
      clears: window.__MIDI_TEST__.clears,
      playing: window.__SEQ.transport.playing,
    };
  });
  // downbeat note-on/off on ch3 from the very first 0xf8 (not the sixth)
  expect(result.afterFirstTick).toContainEqual([0x92, 64, 100]);
  expect(result.afterFirstTick).toContainEqual([0x82, 64, 0]);
  // stopTransport → panic: CC123 + CC120 on all 16 channels + clear()
  expect(result.all.filter((m) => (m[0] & 0xf0) === 0xb0 && m[1] === 123)).toHaveLength(16);
  expect(result.all.filter((m) => (m[0] & 0xf0) === 0xb0 && m[1] === 120)).toHaveLength(16);
  expect(result.clears).toBe(1);
  expect(result.playing).toBe(false);
});

test('structural edits mid-playback never panic and notes keep flowing (cycle 5)', async ({ page }) => {
  // extra TRANSPOSE + cable to delete mid-stream
  const patch = extPatch(
    [{ id: 4, type: 'TRANSPOSE', x: 0, y: 0, params: { semis: 0 }, disabled: {} }],
    [{ from: { mid: 2, port: 'note' }, to: { mid: 4, port: 'in' }, type: 'note' }],
  );
  await openApp(page, { bootPatch: patch, ...stubDevices });
  const result = await page.evaluate(() => {
    const app = window.__SEQ;
    const tick6 = () => {
      for (let i = 0; i < 6; i++) window.__MIDI_TEST__.message('clock-in', [0xf8]);
    };
    window.__MIDI_TEST__.message('clock-in', [0xfa]);
    tick6(); tick6(); // 2 pulses with the full patch
    const sentBefore = window.__MIDI_TEST__.sent.length;
    app.deleteCable(app.cables.length - 1); // structural edits mid-playback
    app.removeModule(4);
    app.addModule('DIV', 0, 0);
    tick6(); tick6(); // 2 more pulses after the edits
    const all = window.__MIDI_TEST__.sent.map((m) => m.data);
    return {
      cc123: all.filter((m) => (m[0] & 0xf0) === 0xb0 && m[1] === 123).length,
      cc120: all.filter((m) => (m[0] & 0xf0) === 0xb0 && m[1] === 120).length,
      clears: window.__MIDI_TEST__.clears,
      noteOnsAfterEdit: window.__MIDI_TEST__.sent
        .slice(sentBefore)
        .filter((m) => (m.data[0] & 0xf0) === 0x90 && m.data[2] > 0).length,
    };
  });
  expect(result.cc123).toBe(0);   // no all-notes-off
  expect(result.cc120).toBe(0);   // no all-sound-off
  expect(result.clears).toBe(0);  // no out.clear()
  expect(result.noteOnsAfterEdit).toBeGreaterThan(0); // playback survived the edits
});

test('the demo patch produces every voice from 4 bars of external clock (cycle 2)', async ({ page }) => {
  await openApp(page, {
    bootPatch: demoPatch,
    inputs: [{ id: 'iac-in', name: 'IAC Driver Bus 1' }],
    outputs: [{ id: 'iac-out', name: 'IAC Driver Bus 1' }],
    random: 0.5, // pins CHANCE (prob 80): 50 < 80 → every arp note passes
  });
  const counts = await page.evaluate(() => {
    window.__MIDI_TEST__.message('iac-in', [0xfa]);
    for (let i = 0; i < 64 * 6; i++) window.__MIDI_TEST__.message('iac-in', [0xf8]); // 4 bars
    const perCh = {};
    for (const { data } of window.__MIDI_TEST__.sent) {
      if ((data[0] & 0xf0) !== 0x90 || data[2] === 0) continue; // note-ons only
      const ch = (data[0] & 0x0f) + 1;
      perCh[ch] = (perCh[ch] || 0) + 1;
    }
    return perCh;
  });
  // issue #4 cycle 2 tallies, with CHANCE pinned deterministic: ch1 pad
  // 4 chords × 4 voices; ch2 arp 32 eighths (all pass); ch3 bass 16
  // quarters; ch4 euclid 5-of-16 over 4 bars = 20; ch10 drums fire too.
  expect(counts).toMatchObject({ 1: 16, 2: 32, 3: 16, 4: 20 });
  expect(counts[10]).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run the new spec**

Run: `npx playwright test --project=chromium tests/clock-panic.spec.mjs`
Expected: PASS (3 tests). If the demo-patch tallies drift, re-derive from `demos/melodic-arp-chords.json` (the patch is the source of truth, not issue #4's snapshot of an older version — its CHANCE is `prob: 80` today vs 85 in the issue).

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS (52 tests).

- [ ] **Step 4: Commit**

```bash
git add tests/clock-panic.spec.mjs
git commit -m "test: external clock downbeat, edit-time panic discipline, demo signal flow (issue #4 cycles 2/5)"
```

---

### Task 9: STEP mute/skip UI gestures

**Files:**
- Create: `tests/step-ui.spec.mjs`

**Interfaces:**
- Consumes: `openApp`, `emptyPatch` from `tests/helpers.mjs`. Gestures (from `paintStart`, `index.html:3586-3612`): alt+click toggles `mode:'mute'` (only on steps with a note), shift+click toggles `mode:'skip'`; cell classes bound at `index.html:1693` (`on`, `mute`, `skip`, `noted`). Module root carries `data-mid`.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the test — `tests/step-ui.spec.mjs`**

```js
import { test, expect } from '@playwright/test';
import { emptyPatch, openApp } from './helpers.mjs';

test('alt/shift clicks cycle STEP cells through mute and skip', async ({ page }) => {
  await openApp(page, { bootPatch: emptyPatch() });
  const stepId = await page.evaluate(() => {
    const step = window.__SEQ.addModule('STEP', 20, 20);
    step.params.steps[0].on = true;
    step.params.steps[1].on = true;
    return step.id;
  });
  const cells = page.locator(`.module[data-mid="${stepId}"] .cell`);

  await cells.nth(0).click({ modifiers: ['Alt'] });     // mute a noted step
  await expect(cells.nth(0)).toHaveClass(/mute/);
  await cells.nth(1).click({ modifiers: ['Shift'] });   // skip a noted step
  await expect(cells.nth(1)).toHaveClass(/skip/);
  await expect(cells.nth(1)).toHaveClass(/noted/);      // skip keeps its note
  await cells.nth(2).click({ modifiers: ['Alt'] });     // mute on an EMPTY step: no-op

  let modes = await page.evaluate((id) => {
    const step = window.__SEQ.modules.find((m) => m.id === id);
    return step.params.steps.slice(0, 3).map((s) => s.mode ?? null);
  }, stepId);
  expect(modes).toEqual(['mute', 'skip', null]);

  await cells.nth(0).click({ modifiers: ['Alt'] });     // alt again → back to normal
  await expect(cells.nth(0)).not.toHaveClass(/mute/);
  await expect(cells.nth(0)).toHaveClass(/on/);
  modes = await page.evaluate((id) => {
    const step = window.__SEQ.modules.find((m) => m.id === id);
    return step.params.steps.slice(0, 2).map((s) => s.mode ?? null);
  }, stepId);
  expect(modes).toEqual([null, 'skip']);
});
```

- [ ] **Step 2: Run the new spec**

Run: `npx playwright test --project=chromium tests/step-ui.spec.mjs`
Expected: PASS (1 test).

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS (53 tests).

- [ ] **Step 4: Commit**

```bash
git add tests/step-ui.spec.mjs
git commit -m "test: STEP mute/skip cell gestures"
```

---

### Task 10: EXPORT APP round-trip and boot precedence

**Files:**
- Create: `tests/export.spec.mjs`

**Interfaces:**
- Consumes: `openApp`, `installAppStubs`, `emptyPatch`, `APP_PATH` from `tests/helpers.mjs`. EXPORT APP is the top-bar button labeled "EXPORT APP" (`saveStandalone`, `index.html:5010-5047`); boot precedence is `__LAMBDA_BOOT_PATCH__` > localStorage > default (`index.html:5277-5286`).
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the tests — `tests/export.spec.mjs`**

```js
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';
import { APP_PATH, emptyPatch, installAppStubs, openApp } from './helpers.mjs';

test('EXPORT APP reopens offline with the exported patch baked in', async ({ page, context }) => {
  await openApp(page, { bootPatch: emptyPatch() });
  await page.evaluate(() => {
    const step = window.__SEQ.addModule('STEP', 123, 234);
    step.params.steps[0].on = true;
    step.params.steps[0].pitch = 77;
  });
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'EXPORT APP' }).click();
  const download = await downloadPromise;
  const downloadedPath = await download.path();
  expect(downloadedPath).toBeTruthy();

  // open the exported HTML in a fresh page with NO server route — offline
  const exported = await context.newPage();
  await installAppStubs(exported);
  const html = await readFile(downloadedPath, 'utf8');
  await exported.setContent(html, { waitUntil: 'load' });
  await exported.waitForFunction(() => window.__SEQ);
  const result = await exported.evaluate(() => {
    const step = window.__SEQ.modules.find((m) => m.type === 'STEP');
    return { count: window.__SEQ.modules.length, x: step.x, y: step.y, first: { ...step.params.steps[0] } };
  });
  expect(result).toMatchObject({ count: 1, x: 123, y: 234, first: { on: true, pitch: 77 } });
});

test('the source application boots directly from file://', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await installAppStubs(page, { bootPatch: emptyPatch() });
  await page.goto(pathToFileURL(APP_PATH).href);
  await page.waitForFunction(() => window.__SEQ && window.__SEQ_TEST__);
  expect(errors).toEqual([]);
  await expect(page.locator('#app')).toBeVisible();
});

test('a baked boot patch beats a localStorage autosave (issue #4 caveat)', async ({ page }) => {
  // an exported snapshot must boot ITS patch even if this browser has an
  // autosave — so remaps made inside an exported file don't persist (by design)
  const bootPatch = emptyPatch([
    { id: 1, type: 'STEP', x: 0, y: 0, params: { len: 4 }, disabled: {} },
  ]);
  const savedPatch = emptyPatch([
    { id: 1, type: 'EUCLID', x: 0, y: 0, params: {}, disabled: {} },
  ]);
  await openApp(page, { bootPatch, savedPatch });
  const types = await page.evaluate(() => window.__SEQ.modules.map((m) => m.type));
  expect(types).toEqual(['STEP']); // boot patch won, autosave ignored
});
```

- [ ] **Step 2: Run the new spec**

Run: `npx playwright test --project=chromium tests/export.spec.mjs`
Expected: PASS (3 tests).

- [ ] **Step 3: Run the whole suite**

Run: `npm test`
Expected: PASS (56 tests).

- [ ] **Step 4: Commit**

```bash
git add tests/export.spec.mjs
git commit -m "test: EXPORT APP offline round-trip, file:// boot, boot-patch precedence"
```

---

### Task 11: Viktor synth engine (audio project)

**Files:**
- Create: `tests/audio.spec.mjs`

**Interfaces:**
- Consumes: `openApp`, `emptyPatch` from `tests/helpers.mjs`; `window.__SEQ_TEST__.viktorRts()` (Map of module id → `{engine, ctx, volumeNode, timers, sounding, loadedPatch}`, see `index.html:2394-2401`); `window.NV1.defaultPatches` (64 factory patches); `window.__SEQ.applyViktorParams()`. Runs ONLY under the `audio` Playwright project (autoplay allowed, null audio output); `npm test` skips it.
- Produces: nothing consumed by later tasks.

- [ ] **Step 1: Write the tests — `tests/audio.spec.mjs`**

```js
import { test, expect } from '@playwright/test';
import { emptyPatch, openApp } from './helpers.mjs';

test.describe.configure({ mode: 'serial' }); // engine init is heavy; don't parallelize

test('Viktor instances are independent engines on one shared AudioContext', async ({ page }) => {
  test.setTimeout(30_000);
  await openApp(page, { bootPatch: emptyPatch() });
  await page.locator('body').click({ position: { x: 5, y: 5 } }); // user gesture
  const result = await page.evaluate(() => {
    const app = window.__SEQ;
    app.addModule('VIKTOR', 0, 0, { params: { patchName: 'Electric Piano', volume: 0.5 } });
    app.addModule('VIKTOR', 0, 0, { params: { patchName: 'Electric Clavessine', volume: 0.8 } });
    app.applyViktorParams();
    const runtimes = [...window.__SEQ_TEST__.viktorRts().values()];
    return {
      size: runtimes.length,
      separateEngines: runtimes[0].engine !== runtimes[1].engine,
      sharedContext: runtimes[0].ctx === runtimes[1].ctx,
      patches: runtimes.map((rt) => rt.loadedPatch),
      factoryPatchCount: Object.keys(window.NV1.defaultPatches).length,
    };
  });
  expect(result.size).toBe(2);
  expect(result.separateEngines).toBe(true);
  expect(result.sharedContext).toBe(true);
  expect(result.patches).toEqual(['Electric Piano', 'Electric Clavessine']);
  expect(result.factoryPatchCount).toBe(64);
});

test('Viktor enforces its 4-instance limit and disposes only the removed engine', async ({ page }) => {
  test.setTimeout(30_000);
  await openApp(page, { bootPatch: emptyPatch() });
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  const result = await page.evaluate(() => {
    const app = window.__SEQ;
    const modules = Array.from({ length: 5 }, () => app.addModule('VIKTOR', 0, 0));
    app.applyViktorParams();
    const before = window.__SEQ_TEST__.viktorRts().size;
    const removedId = modules[1].id;
    app.removeModule(removedId);
    return {
      moduleCount: app.modules.filter((m) => m.type === 'VIKTOR').length,
      fifthWasExisting: modules[4].id === modules[3].id,
      before,
      after: window.__SEQ_TEST__.viktorRts().size,
      removedPresent: window.__SEQ_TEST__.viktorRts().has(removedId),
    };
  });
  expect(result).toEqual({
    moduleCount: 3,
    fifthWasExisting: true,
    before: 4,
    after: 3,
    removedPresent: false,
  });
});
```

- [ ] **Step 2: Run the audio project**

Run: `npm run test:audio`
Expected: PASS (2 tests). These are the slowest tests in the suite (engine construction); the 30s timeouts are intentional.

- [ ] **Step 3: Verify the fast suite is unaffected**

Run: `npm test`
Expected: PASS (56 tests) — `audio.spec.mjs` is excluded from the `chromium` project.

- [ ] **Step 4: Commit**

```bash
git add tests/audio.spec.mjs
git commit -m "test: Viktor engine independence, limits, disposal (audio project)"
```

---

### Task 12: CI workflow + documentation

**Files:**
- Create: `.github/workflows/test.yml`
- Modify: `README.md` (add a Testing section after the Development section)

**Interfaces:**
- Consumes: `npm run test:all` (Task 1 scripts). Nothing downstream.

- [ ] **Step 1: Create `.github/workflows/test.yml`**

```yaml
name: Tests

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
      - run: npm run test:all
      - uses: actions/upload-artifact@v4
        if: failure()
        with:
          name: playwright-report
          path: playwright-report/
          retention-days: 7
```

- [ ] **Step 2: Add a Testing section to `README.md`**

Insert after the `## Development` section:

```markdown
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
```

- [ ] **Step 3: Verify the full suite passes locally**

Run: `npm run test:all`
Expected: PASS (58 tests). (CI can only be verified after push; the workflow is intentionally identical to the local commands.)

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/test.yml README.md
git commit -m "test: CI workflow and README testing docs"
```

---

## Issue #4 assertion coverage map

| Issue #4 checklist item | Task |
|---|---|
| Cycle 1 — silent name resolution / modal on unknown names | 7 |
| Cycle 2 — per-channel note tallies from external clock | 8 |
| Cycle 3 — grouping, map-all, persistence, reload, nag-every-time | 7 |
| Cycle 4 — same-id rename refresh, display source; rename-cache itself | 7 (cache: out of scope) |
| Cycle 5 — no panic on edits, notes continue, panic on stop | 8 |
| Caveat — boot-patch precedence over localStorage | 10 |

## Out of scope (deliberately)

- **Chrome's WebMIDI rename cache** (issue #4, Cycle-4 correction): renames of existing OS devices are invisible to an open browser process — a real-browser/OS property requiring the Playwright + CoreMIDI helper harness described in the issue. Not reproducible with stubs; excluded by design.
- **CHANCE distribution** beyond the deterministic extremes / pinned `Math.random` (flaky by nature).
- **The internal CLOCK scheduler's wall-clock accuracy** (`scheduler()`/`setTimeout` lookahead) — timing-jitter measurement, not a pass/fail assertion. External-clock paths are covered instead (Task 8).
- **Drag-interaction UI** (cable patching, node dragging, marquee, auto-scroll) — high effort/flake risk; the underlying graph logic is covered by Tasks 5–6. Revisit only if regressions appear.
- **In-app device aliases** — deferred feature per issue #4, not built, nothing to test.

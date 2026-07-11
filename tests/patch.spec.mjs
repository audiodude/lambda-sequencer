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
  // (it returns the existing CLOCK early), so id 7 does NOT advance nextId;
  // accepted ids are 1 and 2, so the next module gets id 3.
  expect(out.newId).toBe(3);
});

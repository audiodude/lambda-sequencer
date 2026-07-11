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

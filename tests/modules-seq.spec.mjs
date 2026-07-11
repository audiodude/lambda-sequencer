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
  // hits=4, steps=16 → hits at 0,4,8,12 (verified in helpers-fns spec)
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

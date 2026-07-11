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
  // must deliver the retune BEFORE euclid's clock tick, so euclid's first
  // hit already carries the modulated pitch.
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

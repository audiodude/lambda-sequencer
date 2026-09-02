import { test, expect } from '@playwright/test';
import { openApp, emptyPatch, runModule, noteOns, noteOffs } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await openApp(page, {
    bootPatch: emptyPatch(),
    outputs: [{ id: 'dev1', name: 'Fake Synth' }],
  });
});

test('PIANO passes notes through untouched and records the last one', async ({ page }) => {
  const ev = { kind: 'note', time: 3, pitch: 100, vel: 37, gateLen: 0.4 }; // outside the 3-octave window
  const { emitted, state } = await runModule(page, {
    type: 'PIANO',
    events: [{ port: 'in', ev }],
  });
  expect(emitted).toEqual([{ port: 'out', ev }]);
  expect(state.last).toEqual({ pitch: 100, vel: 37 });
});

test('clicking a key sends a note with the module VEL/GATE; glissando retriggers only while pressed', async ({ page }) => {
  const ids = await page.evaluate(() => {
    const app = window.__SEQ;
    const piano = app.addModule('PIANO', 20, 20);
    piano.params.vel = 77;
    piano.params.gate = 0.3;
    const out = app.addModule('MIDIOUT', 500, 20);
    out.params.deviceId = 'dev1';
    app.cables.push({ from: { mid: piano.id, port: 'out' }, to: { mid: out.id, port: 'in' }, type: 'note' });
    return { piano: piano.id };
  });
  const key = (p) => page.locator(`.module[data-mid="${ids.piano}"] .key[data-pitch="${p}"]`);
  await expect(key(48)).toHaveClass(/white/); // BASE 2 → C2 is the lowest key
  await expect(key(83)).toBeVisible(); // …B4 the highest

  await key(60).click();
  await expect(key(60)).toHaveClass(/lit/);
  await expect(page.locator(`.module[data-mid="${ids.piano}"] .scaledisp`)).toHaveText('C3 · 77');
  await expect(key(60)).not.toHaveClass(/lit/); // gate expired (0.3s)

  let sent = await page.evaluate(() => window.__MIDI_TEST__.sent);
  expect(noteOns(sent).map((m) => m.data)).toEqual([[0x90, 60, 77]]);
  const [on] = noteOns(sent), [off] = noteOffs(sent);
  expect(off.data).toEqual([0x80, 60, 0]);
  expect(off.timestamp - on.timestamp).toBeCloseTo(300, 0);

  // press E3, drag along the white keys to G3, release, then move back:
  // E F G fire (F# sits above the drag path), nothing after release
  const e3 = await key(64).boundingBox();
  const g3 = await key(67).boundingBox();
  const y = e3.y + e3.height - 5;
  await page.mouse.move(e3.x + e3.width / 2, y);
  await page.mouse.down();
  for (let i = 1; i <= 12; i++) await page.mouse.move(e3.x + e3.width / 2 + ((g3.x - e3.x) * i) / 12, y);
  await page.mouse.up();
  await page.mouse.move(e3.x + e3.width / 2, y);
  sent = await page.evaluate(() => window.__MIDI_TEST__.sent);
  expect(noteOns(sent).map((m) => m.data[1])).toEqual([60, 64, 65, 67]);
});

test('STOP clears PIANO highlights and params survive a save/load round-trip', async ({ page }) => {
  const result = await page.evaluate(async () => {
    const app = window.__SEQ;
    const piano = app.addModule('PIANO', 20, 20);
    piano.params.base = 4;
    piano.params.gate = 4;
    app.startTransport();
    // deliver a long note straight into the module (as a cable would)
    window.__SEQ_TEST__.TYPES.PIANO.onInput(app, piano, 'in', { kind: 'note', time: 0, pitch: 60, vel: 100, gateLen: 4 });
    await new Promise((r) => setTimeout(r, 20));
    const litBefore = { ...piano.state.lit };
    app.stopTransport();
    const litAfter = { ...piano.state.lit };
    const json = JSON.parse(JSON.stringify(app.serialize()));
    app.load(json);
    const reloaded = app.modules.find((m) => m.type === 'PIANO');
    return { litBefore, litAfter, timers: piano.state._litT.size, params: { ...reloaded.params } };
  });
  expect(result.litBefore).toEqual({ 60: 1 });
  expect(result.litAfter).toEqual({});
  expect(result.timers).toBe(0);
  expect(result.params).toEqual({ base: 4, vel: 100, gate: 4 });
});

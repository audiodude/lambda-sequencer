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

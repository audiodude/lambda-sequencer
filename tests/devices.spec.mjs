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
    savedPatch: remapped, // no bootPatch → localStorage wins
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

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

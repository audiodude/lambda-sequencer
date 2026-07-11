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

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

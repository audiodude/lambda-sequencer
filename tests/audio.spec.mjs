import { test, expect } from '@playwright/test';
import { emptyPatch, openApp } from './helpers.mjs';

test.describe.configure({ mode: 'serial' }); // engine init is heavy; don't parallelize

test('Viktor instances are independent engines on one shared AudioContext', async ({ page }) => {
  test.setTimeout(30_000);
  await openApp(page, { bootPatch: emptyPatch() });
  await page.locator('body').click({ position: { x: 5, y: 5 } }); // user gesture
  const result = await page.evaluate(() => {
    const app = window.__SEQ;
    app.addModule('VIKTOR', 0, 0, { params: { patchName: 'Electric Piano', volume: 0.5 } });
    app.addModule('VIKTOR', 0, 0, { params: { patchName: 'Electric Clavessine', volume: 0.8 } });
    app.applyViktorParams();
    const runtimes = [...window.__VIKTOR().values()];
    return {
      size: runtimes.length,
      separateEngines: runtimes[0].engine !== runtimes[1].engine,
      sharedContext: runtimes[0].ctx === runtimes[1].ctx,
      patches: runtimes.map((rt) => rt.loadedPatch),
      factoryPatchCount: Object.keys(window.NV1.defaultPatches).length,
    };
  });
  expect(result.size).toBe(2);
  expect(result.separateEngines).toBe(true);
  expect(result.sharedContext).toBe(true);
  expect(result.patches).toEqual(['Electric Piano', 'Electric Clavessine']);
  expect(result.factoryPatchCount).toBe(64);
});

test('Viktor enforces its 4-instance limit and disposes only the removed engine', async ({ page }) => {
  test.setTimeout(30_000);
  await openApp(page, { bootPatch: emptyPatch() });
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  const result = await page.evaluate(() => {
    const app = window.__SEQ;
    const modules = Array.from({ length: 5 }, () => app.addModule('VIKTOR', 0, 0));
    app.applyViktorParams();
    const before = window.__VIKTOR().size;
    const removedId = modules[1].id;
    app.removeModule(removedId);
    return {
      moduleCount: app.modules.filter((m) => m.type === 'VIKTOR').length,
      fifthWasExisting: modules[4].id === modules[3].id,
      before,
      after: window.__VIKTOR().size,
      removedPresent: window.__VIKTOR().has(removedId),
    };
  });
  expect(result).toEqual({
    moduleCount: 3,
    fifthWasExisting: true,
    before: 4,
    after: 3,
    removedPresent: false,
  });
});

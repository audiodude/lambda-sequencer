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

test('Viktor tweaks seed from the patch, apply live, and reset on patch change', async ({ page }) => {
  test.setTimeout(30_000);
  await openApp(page, { bootPatch: emptyPatch() });
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  const result = await page.evaluate(() => {
    const app = window.__SEQ;
    const m = app.addModule('VIKTOR', 0, 0, { params: { patchName: 'Electric Piano' } });
    app.applyViktorParams();
    const inst = () => window.__VIKTOR().get(m.id).engine.instruments[0];
    const engineVals = () => {
      const env = inst().envelopesSettings.primary;
      const flt = inst().filterSettings;
      return {
        attack: env.attack.value,
        decay: env.decay.value,
        sustain: env.sustain.value,
        release: env.release.value,
        cutoff: flt.cutoff.value,
        resonance: flt.emphasis.value,
      };
    };
    const patchVals = engineVals();
    const seeded = { ...m.params.tweaks };

    // user drags sliders: params override the engine, clamped to ranges
    Object.assign(m.params.tweaks, {
      attack: 1.5,
      decay: 0.25,
      sustain: 0.9,
      release: 1.8,
      cutoff: 1234,
      resonance: 99, // beyond the engine's [0.4, 40] range
    });
    m.params.tweaked = true;
    app.applyViktorParams();
    const applied = engineVals();

    // RESET: engine returns to the patch's own values, sliders re-seed
    app.viktorResetTweaks(m);
    const afterReset = { engine: engineVals(), tweaks: { ...m.params.tweaks }, tweaked: m.params.tweaked };

    // patch switch drops tweaks and re-seeds from the new patch
    m.params.tweaked = true;
    m.params.tweaks.attack = 1.9;
    app.applyViktorParams();
    m.params.tweaked = false; // what the panel's patchPicked() does
    m.params.patchName = 'Clean Sine';
    app.applyViktorParams();
    const afterSwitch = { attack: m.params.tweaks.attack, loaded: window.__VIKTOR().get(m.id).loadedPatch };

    return { patchVals, seeded, applied, afterReset, afterSwitch };
  });

  // untouched module: sliders show the patch's real values
  expect(result.seeded).toEqual(result.patchVals);
  // tweaks landed in the engine (resonance clamped to 40)
  expect(result.applied).toEqual({
    attack: 1.5,
    decay: 0.25,
    sustain: 0.9,
    release: 1.8,
    cutoff: 1234,
    resonance: 40,
  });
  // RESET restored the patch sound and re-seeded the sliders
  expect(result.afterReset.tweaked).toBe(false);
  expect(result.afterReset.engine).toEqual(result.patchVals);
  expect(result.afterReset.tweaks).toEqual(result.patchVals);
  // patch switch re-seeded from the new patch (1.9 override gone)
  expect(result.afterSwitch.loaded).toBe('Clean Sine');
  expect(result.afterSwitch.attack).not.toBe(1.9);
});

test('panel knobs drag with the pointer and mark the module tweaked', async ({ page }) => {
  test.setTimeout(30_000);
  await openApp(page, { bootPatch: emptyPatch() });
  await page.locator('body').click({ position: { x: 5, y: 5 } });
  await page.evaluate(() => {
    const app = window.__SEQ;
    app.addModule('VIKTOR', 0, 0);
    app.setView('viktor');
  });
  const knob = page.locator('[aria-label="ATTACK"]');
  await knob.waitFor();
  const box = await knob.boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + 20;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx, cy - 80, { steps: 8 }); // 80px up ≈ +1.0s of a 2s range
  await page.mouse.up();
  const r = await page.evaluate(() => {
    const m = window.__SEQ.modules.find((x) => x.type === 'VIKTOR');
    return {
      tweaked: m.params.tweaked,
      attack: m.params.tweaks.attack,
      engineAttack: window.__VIKTOR().get(m.id).engine.instruments[0]
        .envelopesSettings.primary.attack.value,
    };
  });
  expect(r.tweaked).toBe(true);
  expect(r.attack).toBeGreaterThan(0.9);
  expect(r.engineAttack).toBeCloseTo(r.attack, 5);
});

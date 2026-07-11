import { test, expect } from '@playwright/test';
import { openApp, emptyPatch } from './helpers.mjs';

test.beforeEach(async ({ page }) => {
  await openApp(page, { bootPatch: emptyPatch() });
});

// Evaluate a __SEQ_TEST__ function by name with JSON args.
const call = (page, fn, ...args) =>
  page.evaluate(
    ({ fn, args }) => window.__SEQ_TEST__[fn](...args),
    { fn, args },
  );

test('clamp bounds values', async ({ page }) => {
  expect(await call(page, 'clamp', 5, 0, 10)).toBe(5);
  expect(await call(page, 'clamp', -1, 0, 10)).toBe(0);
  expect(await call(page, 'clamp', 11, 0, 10)).toBe(10);
});

test('secondsPerPulse is a 1/16 at the given bpm', async ({ page }) => {
  expect(await call(page, 'secondsPerPulse', 120)).toBeCloseTo(0.125);
  expect(await call(page, 'secondsPerPulse', 60)).toBeCloseTo(0.25);
});

test('midiToNoteName uses Ableton octaves (60 = C3)', async ({ page }) => {
  expect(await call(page, 'midiToNoteName', 60)).toBe('C3');
  expect(await call(page, 'midiToNoteName', 61)).toBe('C#3');
  expect(await call(page, 'midiToNoteName', 0)).toBe('C-2');
  expect(await call(page, 'midiToNoteName', 127)).toBe('G8');
  expect(await call(page, 'midiToNoteName', -1)).toBe('?');
  expect(await call(page, 'midiToNoteName', 128)).toBe('?');
});

test('parseNoteName round-trips names, accidentals, case', async ({ page }) => {
  expect(await call(page, 'parseNoteName', 'C3')).toBe(60);
  expect(await call(page, 'parseNoteName', 'f#2')).toBe(54);
  expect(await call(page, 'parseNoteName', 'Bb4')).toBe(82);
  expect(await call(page, 'parseNoteName', ' C3 ')).toBe(60); // trimmed
  expect(await call(page, 'parseNoteName', 'C-2')).toBe(0);
  expect(await call(page, 'parseNoteName', 'G8')).toBe(127);
});

test('parseNoteName rejects invalid and out-of-range input', async ({ page }) => {
  expect(await call(page, 'parseNoteName', 'H3')).toBe(null);
  expect(await call(page, 'parseNoteName', 'C')).toBe(null);   // octave required
  expect(await call(page, 'parseNoteName', '60')).toBe(null);
  expect(await call(page, 'parseNoteName', 'G#8')).toBe(null); // 128
  expect(await call(page, 'parseNoteName', 'Cb-2')).toBe(null); // -1
  expect(await call(page, 'parseNoteName', '')).toBe(null);
});

const idxOf = (pattern) =>
  pattern.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);

test('euclidPattern distributes hits', async ({ page }) => {
  expect(idxOf(await call(page, 'euclidPattern', 4, 16, 0))).toEqual([0, 4, 8, 12]);
  // NOTE: this implementation is floor(i*steps/hits), not true Bjorklund —
  // E(3,8) lands on [0,2,5] here (classic tresillo would be [0,3,6]).
  expect(idxOf(await call(page, 'euclidPattern', 3, 8, 0))).toEqual([0, 2, 5]);
  expect(idxOf(await call(page, 'euclidPattern', 8, 8, 0))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
});

test('euclidPattern edge cases: zero hits, clamped hits, rotation', async ({ page }) => {
  expect(await call(page, 'euclidPattern', 0, 8, 0)).toEqual(new Array(8).fill(false));
  // hits clamps to steps
  expect(idxOf(await call(page, 'euclidPattern', 5, 3, 0))).toEqual([0, 1, 2]);
  // rotation, incl. negative and > steps
  expect(idxOf(await call(page, 'euclidPattern', 1, 4, 1))).toEqual([1]);
  expect(idxOf(await call(page, 'euclidPattern', 1, 4, -1))).toEqual([3]);
  expect(idxOf(await call(page, 'euclidPattern', 1, 4, 5))).toEqual([1]);
});

test('quantize snaps to nearest scale tone (ties go down)', async ({ page }) => {
  const major = [0, 2, 4, 5, 7, 9, 11];
  // 61 (C#) is 1 away from both 60 and 62; strict < keeps the first (lower)
  expect(await call(page, 'quantize', 61, 0, major)).toBe(60);
  expect(await call(page, 'quantize', 60, 0, major)).toBe(60); // already in scale
  const pentMin = [0, 3, 5, 7, 10];
  expect(await call(page, 'quantize', 66, 0, pentMin)).toBe(65);
  // empty scale array passes pitch through
  expect(await call(page, 'quantize', 61, 0, [])).toBe(61);
});

test('scalePitches spans 0..127, sorted, root-shifted', async ({ page }) => {
  const cMajor = await call(page, 'scalePitches', 0, 'major');
  expect(cMajor[0]).toBe(0);
  expect(cMajor).toContain(60);
  expect(cMajor).not.toContain(61);
  expect(cMajor.every((n) => n >= 0 && n <= 127)).toBe(true);
  const sorted = [...cMajor].sort((a, b) => a - b);
  expect(cMajor).toEqual(sorted);
  // unknown scale name falls back to chromatic (128 pitches)
  const chroma = await call(page, 'scalePitches', 0, 'nope');
  expect(chroma.length).toBe(128);
});

test('buildChord stacks diatonic degrees', async ({ page }) => {
  // C major triad on C3
  expect(await call(page, 'buildChord', 60, 0, 'major', 'triad', 3, 0)).toEqual([60, 64, 67]);
  // diatonic triad on D is minor: D-F-A
  expect(await call(page, 'buildChord', 62, 0, 'major', 'triad', 3, 0)).toEqual([62, 65, 69]);
  // 7th
  expect(await call(page, 'buildChord', 60, 0, 'major', '7th', 4, 0)).toEqual([60, 64, 67, 71]);
  // sus2 / sus4
  expect(await call(page, 'buildChord', 60, 0, 'major', 'sus2', 3, 0)).toEqual([60, 62, 67]);
  expect(await call(page, 'buildChord', 60, 0, 'major', 'sus4', 3, 0)).toEqual([60, 65, 67]);
});

test('buildChord voices, inversion, edges', async ({ page }) => {
  // voices trims the recipe
  expect(await call(page, 'buildChord', 60, 0, 'major', 'triad', 2, 0)).toEqual([60, 64]);
  // first inversion rotates the bass up an octave
  expect(await call(page, 'buildChord', 60, 0, 'major', 'triad', 3, 1)).toEqual([64, 67, 72]);
  // off-scale input quantizes first (61 → 60)
  expect(await call(page, 'buildChord', 61, 0, 'major', 'triad', 3, 0)).toEqual([60, 64, 67]);
  // near the top of the range, out-of-range voices are dropped
  const top = await call(page, 'buildChord', 126, 0, 'major', 'triad', 3, 0);
  expect(top.every((n) => n <= 127)).toBe(true);
  // null pitch → empty
  expect(await call(page, 'buildChord', null, 0, 'major', 'triad', 3, 0)).toEqual([]);
});

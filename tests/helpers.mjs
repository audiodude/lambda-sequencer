import { resolve } from 'node:path';
import { expect } from '@playwright/test';

export const APP_PATH = resolve(import.meta.dirname, '..', 'index.html');

// Install WebMIDI stubs + boot state BEFORE any app script runs (issue #4
// harness pattern). Fake outputs record every send()/clear(); fake inputs
// accept injected bytes via window.__MIDI_TEST__.message(id, [0xf8]).
export async function installAppStubs(page, options = {}) {
  const config = {
    inputs: options.inputs || [],
    outputs: options.outputs || [],
    bootPatch: options.bootPatch || null,
    savedPatch: options.savedPatch || null,
    random: options.random,
  };
  await page.addInitScript((cfg) => {
    const sent = [];
    let clears = 0;
    const inputs = new Map(cfg.inputs.map(({ id, name }) => [id, {
      id, name, onmidimessage: null,
    }]));
    const outputs = new Map(cfg.outputs.map(({ id, name }) => [id, {
      id, name,
      send(data, timestamp) { sent.push({ id, data: Array.from(data), timestamp }); },
      clear() { clears++; },
    }]));
    const access = { inputs, outputs, onstatechange: null };
    Object.defineProperty(navigator, 'requestMIDIAccess', {
      configurable: true,
      value: async () => access,
    });
    window.__MIDI_TEST__ = {
      access,
      sent,
      get clears() { return clears; },
      message(id, data) {
        const input = inputs.get(id);
        if (!input || !input.onmidimessage) throw new Error('MIDI input not ready: ' + id);
        input.onmidimessage({ data, target: input });
      },
      statechange() {
        if (access.onstatechange) access.onstatechange({ target: access });
      },
    };
    if (cfg.bootPatch) window.__LAMBDA_BOOT_PATCH__ = cfg.bootPatch;
    if (cfg.savedPatch)
      localStorage.setItem('lambda-seq-v1:' + location.pathname, JSON.stringify(cfg.savedPatch));
    if (cfg.random != null) Math.random = () => cfg.random;
  }, config);
}

// Boot the real app over the local server and fail fast on any page error
// (learnings.md: headless Chrome catches what node --check doesn't).
export async function openApp(page, options = {}) {
  const errors = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  await installAppStubs(page, options);
  await page.goto('/index.html');
  await page.waitForFunction(() => window.__SEQ != null && window.__SEQ_TEST__ != null);
  await page.waitForFunction(() => window.__SEQ.midi.access != null);
  expect(errors, 'no page errors on boot').toEqual([]);
  return errors;
}

export function emptyPatch(modules = [], cables = []) {
  return { bpm: 120, source: 'internal', zoom: 1, modules, cables };
}

// Selectors over recorded MIDI traffic ({ id, data, timestamp }) from the
// WebMIDI stub, so specs assert on musical meaning instead of raw byte masks.
export function noteOns(messages) {
  return messages.filter(({ data }) => (data[0] & 0xf0) === 0x90 && data[2] > 0);
}

export function noteOffs(messages) {
  return messages.filter(({ data }) => (data[0] & 0xf0) === 0x80);
}

// Drive one module's onInput handler against a fake ctx, entirely in-page.
// events: [{ port, ev }, ...] delivered in order.
// Returns { emitted, state, params } (JSON-serializable snapshots).
export function runModule(page, { type, params = {}, events }) {
  return page.evaluate(
    ({ type, params, events }) => {
      const def = window.__SEQ_TEST__.TYPES[type];
      const emitted = [];
      const ctx = {
        transport: { playing: true, bpm: 120 },
        emit: (m, port, ev) => emitted.push({ port, ev }),
      };
      const m = {
        id: 1,
        type,
        params: { ...def.defaults(), ...params },
        state: {},
        disabled: {},
      };
      for (const e of events) def.onInput(ctx, m, e.port, e.ev);
      return JSON.parse(JSON.stringify({ emitted, state: m.state, params: m.params }));
    },
    { type, params, events },
  );
}

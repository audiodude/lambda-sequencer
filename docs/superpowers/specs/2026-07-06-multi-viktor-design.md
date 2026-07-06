# Multi-Viktor — design spec (2026-07-06)

Allow up to **4 VIKTOR modules** in the rack, each an independent instance of the
embedded Viktor NV-1 engine with its own factory patch and volume, all playable
simultaneously. Approved in-session; supersedes the "max one" rule from the
2026-07-01 Viktor embed design.

## Decisions (user-approved)

- **Synth pane: stack all panels.** The VIKTOR view renders one panel per
  VIKTOR module, vertically, in module order. No tabs.
- **Cap: 4.** A 5th VIKTOR is rejected on add, same mechanic as the 2nd CLOCK.
- Everything else below follows from the existing architecture.

## Audio core

- **One shared `AudioContext`** across all engines. `NV1.create(AC, store)`
  passes a constructor; upstream `daw.js` calls `new AudioContext()`. We hand it
  a wrapper whose `new` returns the shared context (a JS constructor returning
  an object overrides `this`). The shared context is created by the first
  engine init and reused by all later ones (already unlocked, no extra gesture
  handling).
- **Singleton → registry.** `viktorRt` becomes `viktorRts: Map<moduleId, rt>`;
  `rt = { engine, volumeNode, timers, sounding, loadedPatch }`. `ctx` and
  `limiter` move to a shared object created once. All shim functions
  (`viktorEnsure`, `viktorSetPatch`, `viktorSetVolume`, `viktorNote`) take the
  module (or its id) and operate on that module's runtime.
- **Per-runtime chain:** `engine.masterVolume` (disconnected from destination)
  → module `volumeNode` (`params.volume × VIKTOR_MAKEUP`, ramped) → **shared
  limiter** (existing −3 dB / 20:1 settings) → destination. Four hot Viktors
  can legitimately reach the limiter; that is its safety role, not a bug.
- **Shared reverb impulse.** `viktorImpulse(ctx)` is synthesized once per
  context and the same buffer is assigned to every engine's convolver.
- **Lazy init per module**, `viktorFailed` stays global (bundle/AC failure
  fails all). Boot arming arms every VIKTOR module in the boot patch.
- **Teardown on module delete:** cancel pending timers, send note-offs for
  sounding pitches, disconnect `engine.masterVolume` and the `volumeNode`,
  delete the map entry. (The engine has no destroy API; disconnect + drop
  references and let GC take it.)
- **Panic** (STOP / topology change) sweeps all runtimes.
- Debug handle: `window.__VIKTOR = () => viktorRts` (the Map). Harness code
  adapts.

## Rules & routing

- `addModule` guard: reject VIKTOR when 4 already exist (alert mirrors the
  CLOCK wording).
- `TYPES.VIKTOR.onInput` resolves the runtime by the receiving module's id —
  each cable feeds exactly the Viktor it is patched to.
- Per-pitch `sounding` refcounts are per-runtime, so two Viktors holding the
  same pitch cannot steal each other's note-offs.
- Patch JSON: no format change — multiple VIKTOR module entries already
  serialize/load; only the guard changes. Legacy single-Viktor patches load
  unchanged.

## UI

- **Rack module component:** unchanged (patch name, activity LED, OPEN).
- **Synth pane (`viktor-panel`):** `v-for` over a `viktorModules` computed
  (array replaces the `viktorModule` single). Each panel keeps today's layout
  (VIKTOR NV-1 head, big patch name, patch `<select>`, volume slider + %) and
  adds `#<module id>` to the head so identical patches are distinguishable.
- **OPEN** switches to the VIKTOR view (as today) and scrolls that module's
  panel into view (`scrollIntoView`; panel gets `:id="'viktor-panel-' + m.id"`).
- Empty state (no Viktors: "+ ADD VIKTOR") and error state unchanged.

## Docs

- `SCHEMA.md`: VIKTOR section "max one" → "max 4"; note the shared limiter.
- `README.md`: built-in synth section mentions multiple VIKTORs and the
  stacked pane.
- `learnings.md`: add anything genuinely learned during implementation.

## Verification (headless harness, existing idiom)

Null-sink headless Chrome, driving `__SEQ`/`__VIKTOR`:

1. Two VIKTOR modules, different patches, each fed by its own note source —
   both produce audio (independent peak taps on each `volumeNode`), and the
   engines are distinct instances sharing one `AudioContext`.
2. Same pitch through both — note-offs don't cross-talk.
3. Volume of one changed — only its tap level moves.
4. Panic silences both; pending timers cleared.
5. Deleting one module tears down its runtime (map entry gone, its tap goes
   silent, the other keeps playing).
6. 5th VIKTOR add is rejected; 4th succeeds.
7. Legacy single-Viktor default patch still boots and sounds (regression).

## Constraints

- Byte budget: net growth target ≤ ~3 KB on index.html.
- No engine bundle changes (`tools/build-viktor-bundle.sh` untouched).

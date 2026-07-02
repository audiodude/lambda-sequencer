# Viktor NV-1 embed — design

**Date:** 2026-07-01 · **Status:** implemented (2026-07-01)

Embed the [viktor-nv1-engine](https://github.com/nicroto/viktor-nv1-engine) synth
into λ-SEQ as a built-in sound destination, shown in a separate view ("tab") with a
side-by-side option. Single-file, fully-offline operation is a **hard requirement**:
no network requests, `file://` double-click must work, EXPORT APP output must be
self-contained.

## Decisions (settled with user)

1. **Routing:** a new `VIKTOR` module type with a `note` input, cabled like MIDI OUT.
2. **Instances:** max one per patch (same guard as CLOCK).
3. **UI scope:** patch selector + volume only for MVP; a curated knob panel
   (filter/env/FX macros) is an explicit later phase.
4. **Patch bank:** the full 64-patch factory bank ships embedded (~69 KB of the bundle).
5. **Embedding:** vendored minified IIFE bundle (esbuild, `NV1` global), bit-faithful
   to upstream except four tiny documented build-time patches, all I/O-related, zero
   DSP changes (same precedent as the inlined Vue runtime):
   - `const.js`: reverb `impulse` path blanked (no WAV request).
   - `tuna.js`: Convolver's `|| "../impulses/ir_rev_short.wav"` fallback blanked
     (the blank path would otherwise fall through to an XHR).
   - `daw.js`: `midiController.init()` removed — Viktor must not attach to live
     WebMIDI inputs. λ-SEQ's external-clock devices emit 1-byte MIDI clock
     messages, which Viktor's `parseEventData` throws on (24×/quarter-note
     exception spam). Also keeps MIDI-in → Viktor out of scope as decided.
   - build entry re-exports `defaultPatches` (`NV1.defaultPatches`) so the patch
     dropdown can populate before any engine/AudioContext exists (pre-gesture).
6. **Reverb impulse:** synthesized in code at init (no WAV embedded).
7. **Byte budget:** index.html grows ~180–190 KB (177 KB bundle + ~10 KB shim/UI),
   from ~922 KB to ~1.10 MB.

## 1. VIKTOR module (rack side)

- Registry entry: inputs `[{name:'in', type:'note'}]`, outputs `[]`.
- Max one instance — reuse the CLOCK one-instance rejection path.
- `defaults(): { patchName: <factory default>, volume: 0.8 }`. Params ride the
  existing patch JSON machinery, so SAVE/LOAD/EXPORT APP/localStorage autosave and
  device-remap flows need no changes. Old app versions skip unknown module types —
  acceptable degradation.
- Module body: current patch name, activity light (same idiom as MIDI OUT), and an
  OPEN button that switches to the VIKTOR view.

## 2. Engine embedding + lifecycle

- `tools/build-viktor-bundle.sh` clones upstream at a pinned commit, blanks the
  `impulse: "impulses/impulse_rev.wav"` path in `src/daw/engine/const.js` (tuna then
  logs "missing impulse path" and never XHRs), and runs
  `esbuild src/index.js --bundle --minify --format=iife --global-name=NV1`.
  Output is pasted into index.html as a dedicated `<script>` block with a header
  comment recording upstream commit + regeneration command.
- Engine init is lazy: first user gesture after a VIKTOR module exists. Adding the
  module is itself a gesture; a patch loaded at boot arms a one-time
  click/keydown listener. Satisfies autoplay policy.
- `NV1.create(AudioContext, store)` receives an **in-memory store shim**;
  `params.patchName` is the single source of truth for patch selection (no
  localStorage bleed between λ-SEQ patches).
- On init the shim synthesizes the reverb impulse — ~2 s stereo exponentially
  decaying noise at `ctx.sampleRate`, seeded PRNG (xorshift) so it's identical
  every load — and assigns it to the engine's public `dawEngine.reverb` convolver
  node. Zero fetches ever.
- Volume param drives the engine's master gain (exact node resolved at
  implementation; fall back to a shim-owned GainNode between engine output and
  destination if the engine doesn't expose one cleanly).

## 3. Note routing + timing

Full analysis in `learnings.md` ("Viktor NV-1 embed — routing/timing analysis").
Summary: λ-SEQ emits note events up to 35 ms early with exact due times
(`performance.now()` seconds); Viktor's `externalMidiMessage` plays immediately.
The shim parks each event on a `setTimeout` until due (note-on), plus a second
timer at `time + gateLen` (note-off). Residual jitter ~1–4 ms — accepted for MVP.
The shim tracks pending timers + sounding pitches; STOP mirrors the MIDI panic
(cancel timers, fire note-offs). Sample-accurate scheduling via the engine's
`envelope.start(time)` is a phase-2 fork if ever needed.

## 4. Views: tabs + side-by-side

- Top bar gains a view switcher: **RACK | VIKTOR | BOTH**.
  - RACK — today's UI, untouched.
  - VIKTOR — full-width synth page.
  - BOTH — fixed side-by-side split (rack left, Viktor right); no draggable
    divider in MVP.
- View choice is cosmetic UI state persisted to localStorage, not patch JSON.
- With no VIKTOR module in the rack, the VIKTOR view shows one "ADD VIKTOR"
  button that adds the module.

## 5. VIKTOR view content (MVP)

- Patch selector: prev/next buttons + flat dropdown of the 64 factory patches.
- Volume slider.
- Current patch name in large type; styling reuses the module aesthetic.
- Selecting a patch loads it into the engine and writes `params.patchName`.
- Layout reserves space for the phase-2 curated knob panel.

## 6. Error handling

- Missing WebAudio or engine init failure: VIKTOR module + view show an
  unavailable/error state; sequencing to MIDI is unaffected.
- Note events with due times in the past clamp to "play now".

## 7. Success criteria

- STEP → VIKTOR cable produces correct pitches at correct times.
- Patch switching works audibly, including arp patches ("Venga Party") and
  reverb-heavy patches ("Ghosts").
- EXPORT APP output, double-clicked with networking disabled, plays identically.
- STOP silences all Viktor voices and cancels pending timers.
- index.html growth ≤ ~190 KB.
- Page loads clean in headless Chrome (no console errors), with and without a
  VIKTOR module in the boot patch.

## Documentation obligations

- README: Viktor feature section (what it is, offline guarantee, view switcher).
- SCHEMA.md: VIKTOR module entry (ports, params).
- `tools/build-viktor-bundle.sh` documents its own pinned commit; README dev
  section mentions regeneration.

## Out of scope (MVP)

- Curated knob panel (phase 2), full 40+ control editor.
- Multiple VIKTOR instances.
- Sample-accurate scheduling fork.
- Custom/user Viktor patches beyond the factory bank.
- MIDI-in → Viktor live playing.

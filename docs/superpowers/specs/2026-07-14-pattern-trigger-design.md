# PATTRIG — pattern trigger module — design

2026-07-14. **Revised 2026-07-17 (v2):** capture moved from note-triggered
sample-and-hold to sequential drum-mapping assignment on the `pat` input —
see the PATTRIG module section and Rejected alternatives for the change and
its rationale. The signal type, STEP integration, and `KIND_PRI` sections
are unchanged from v1.

## Problem

Recall a different STEP pattern by note — a classic "pattern change" /
performance-sequencer gesture. There's no way today to snapshot a STEP's
configuration and re-trigger it live; patterns are edited in place only.

## New signal type: `pat`

Added alongside `clock`/`note`/`scale`:

```js
{ kind: 'pat', time, params }
```

`params` is exactly a target module's `params` object — the same shape
`serialize()` already writes for that module type (for v1, always STEP's
`{steps, vel, gateLen, len}`). No `type`/`id`/position: the receiving module
already knows its own shape from its cable.

- `SIGNAL_COLORS.pat` gets a new color, distinct from clock (white) / note
  (yellow) / scale (teal) — suggest a violet/magenta.
- `KIND_PRI` gains `pat: 1`, sitting between `scale: 0` and `note: 2`; `clock`
  moves from `2` to `3`. Rationale: same reasoning that puts `scale` before
  `note` (QUANT/CHORD must see a new scale before quantizing) and that lets
  EUCLID's `pitch` (note-kind) retune settle before a coincident `clk` hit —
  a `pat` landing on STEP at the same instant as a `clk` tick must apply
  *before* that tick's step-advance, so the swap takes effect on the very
  tick it arrives rather than one tick late.

## PATTRIG module

**Ports:** inputs `note` (note), `pat` (pat) · output `pat` (pat).

**Params** (persisted — so a locked, populated bank survives reload):

```js
defaults: () => ({
  locked: false,
  table: [],    // [{ note: 24-127, pat: {...} }, ...], capture order
})
```

**On `pat` input (capture):** slots are assigned sequentially like a drum
mapping. If `locked`, ignore. Otherwise the next slot is C0 (MIDI 24) when
the table is empty, else `max(note) + 1`; if that exceeds 127 the bank is
full and the pat is ignored. Push `{ note: slot, pat: ev.params }` and flash
the new row. Nothing is emitted on capture — recall is the note input's job.

**On `note` input (recall):** if `note.pitch` has a row, emit the stored pat:
`ctx.emit(m, 'pat', { kind:'pat', time: ev.time, params: row.pat })` — always
allowed, even when `locked`. Unknown pitches are ignored entirely.

**Slot reuse:** because the next slot derives from the current highest row,
clearing the *newest* row frees its slot for the next capture (a free "undo
last capture"), while clearing a *middle* row leaves that slot empty forever —
learned notes never shift meaning. The bank self-caps at 104 slots (C0–G8).

A shared `pattrigNextSlot(table)` helper computes the next slot for both the
type's `onInput` and the component's NEXT readout.

## STEP integration

**`withPat()`** — a small wrapper (near `TYPES`) that adds pat support to any
module type definition without touching its own `onInput`:

```js
function withPat(def) {
  return {
    ...def,
    inputs: [...def.inputs, { name: 'pat', type: 'pat' }],
    outputs: [...def.outputs, { name: 'pat', type: 'pat' }],
    onInput(ctx, m, port, ev) {
      if (port === 'pat' && ev.kind === 'pat') {
        def.applyPat(m, ev.params);
        return;
      }
      return def.onInput(ctx, m, port, ev);
    },
  };
}
```

**STEP's `TYPES` entry** gains two hooks and is wrapped:

```js
TYPES.STEP = withPat({
  inputs: [{ name: 'clk', type: 'clock' }],
  outputs: [{ name: 'note', type: 'note' }],
  defaults: () => ({ /* unchanged */ }),
  onInput(ctx, m, port, ev) { /* unchanged */ },
  getPat: (m) => JSON.parse(JSON.stringify(m.params)),
  applyPat: (m, pat) => Object.assign(m.params, JSON.parse(JSON.stringify(pat))),
});
```

Both hooks deep-clone via JSON round-trip (matching how `serialize()` already
clones params) rather than a shallow spread — `steps` is an array, and a
shallow copy would leave it as a shared reference, so editing STEP after a
SNAPSHOT would silently mutate a row already captured in PATTRIG's table.

**SNAPSHOT button**, shared via a Vue mixin (same pattern as
`scaleLabelMixin`, already used by QUANT/CHORD):

```js
const patSnapshotMixin = {
  methods: {
    snapshotPat() {
      this.$root.emit(this.module, 'pat', {
        kind: 'pat',
        time: null, // immediate/state-like, not scheduled — sorts like scale
        params: TYPES[this.module.type].getPat(this.module),
      });
    },
  },
};
```

`ModuleStep` adds `mixins: [patSnapshotMixin]` and a SNAPSHOT button near its
existing VEL/GATE/LEN row.

**STEP's template** (`#tmpl-step`) gets the two new ports added to its
`module-frame :inputs`/`:outputs` literals, matching how every other module
declares its ports today (EUCLID uses a computed `frameInputs()` instead of a
literal — there's already variance here, so no framework change is needed to
add a second pat-supporting module later; it gets the same two-line
addition).

A future second module (e.g. EUCLID) needs only: `getPat`/`applyPat` hooks,
`withPat()` wrap, the SNAPSHOT button + mixin on its component, and the two
ports on its template. No change to PATTRIG or the shared framework pieces.

## UI

**PATTRIG panel:**
- **NEXT readout**: shows where the next capture lands ("NEXT: C#0", or
  "FULL" past G8) — reuses the existing `.scaledisp` status-line style with
  a `--pat`-colored override.
- **LOCK toggle**, bound to `params.locked`.
- **CLEAR ALL** button next to LOCK (empties `table`).
- **Table list**: one row per `table` entry, note name via the existing
  `noteName` (`midiToNoteName`) helper, with a per-row `[x]` clear button.
  The most recently touched row (recall or new capture) gets a brief flash
  highlight, mirroring STEP's existing `pitchFlash`/`voicesFlash` convention.

**STEP panel:** the SNAPSHOT button described above.

## Docs

- **SCHEMA.md**: new `pat` signal type entry; new **PATTRIG** module section
  (ports/params as above); STEP's ports table gains `pat` in/out (params
  shape unchanged).
- **PALETTE**: add `'PATTRIG'`, placed after `STEP`.
- **README.md**: short new subsection (scope comparable to the existing
  "Built-in synth" section) walking through the workflow — build a pattern on
  an editor STEP, SNAPSHOT it into the PATTRIG's next slot (C0, C#0, D0…),
  repeat per pattern, cable PATTRIG's output into a player STEP's `pat`
  input and a note source into its `note` input to recall patterns live by
  note; LOCK to freeze the bank.

## Testing

No permanent automated suite exists for module behavior yet (this repo's
existing convention, per `learnings.md`, is an ad-hoc headless smoke harness
driving the `window.__SEQ` debug handle, written for the change and not
necessarily committed). Exercise:

1. Editor STEP → SNAPSHOT → table gains a row at C0; a second SNAPSHOT lands
   at C#0; NEXT readout advances; nothing is emitted during capture.
2. Learned note → stored pat re-emitted; PATTRIG's `pat` output reconfigures
   a player STEP's `steps`/`vel`/`gateLen`/`len` live; player edits don't
   corrupt the stored row (re-recall restores). Recall works even when
   locked; back-to-back recalls aren't rate-limited.
3. Unknown note → nothing (no row, no output).
4. LOCK on → incoming pats ignored; learned notes still recall.
5. Slot reuse: clearing a middle row leaves its slot empty (next capture
   still appends after the highest); clearing the highest row lets the next
   capture reuse its slot. A row at 127 → further pats ignored (bank full).
6. Per-row `[x]` and CLEAR ALL both update `table` and persist through
   save/reload.
7. SAVE PATCH / LOAD PATCH / EXPORT APP round-trip `table`/`locked` and the
   `pat`-typed cables.
8. Regression: existing patches with no PATTRIG modules are unaffected;
   EUCLID's pitch-before-clk same-tick ordering still holds now that
   `clock`'s `KIND_PRI` moved from 2 to 3.

## Scope & rejected alternatives

- **STEP only for v1**, extensible to other module types later via the
  `withPat()`/`getPat`/`applyPat` contract (see STEP integration above) — not
  building generic pat support into every module type now.
- **Table key is pitch only** (0–127), not pitch+velocity — matches a
  "one octave = N pattern slots" performance workflow; a larger sparse key
  space wasn't worth the added complexity.
- **Pat contents are `params` only**, not a full `{type, params, disabled}`
  module object — the receiving module already knows its own type via the
  cable; no validation surface needed for v1's single-type scope.
- **STEP emits `pat` only on an explicit SNAPSHOT click**, not live on every
  param edit — under v2's capture-on-pat semantics a live emit per edit
  (dragging a knob, painting steps) would burn a bank slot per gesture; the
  explicit click is the capture gesture.
- **Pat applies to STEP immediately**, not quantized to a step/loop boundary —
  simplest for v1; matches how TRANSPOSE/QUANT/CHORD already react instantly
  to their inputs. A quantized-swap mode was considered and rejected as
  premature complexity.
- **v1's note-triggered capture (sample-and-hold + debounce) — rejected
  after real-world use.** The shipped v1 captured on a *miss*: an unseen
  note assigned the currently-held pat to that pitch, gated by a flat
  1-second `ev.time` debounce (itself chosen over an earlier clk-gated
  design that had a same-tick ordering race). In practice the gesture is
  unperformable: λ-SEQ has no keyboard/MIDI-in note module (KEY was
  removed), so every note source is clock-driven — with the transport
  stopped (the natural state while building patterns) no notes flow and
  nothing ever captures, and with it running a sequencer hammers the input
  uncontrollably. v2 captures directly on the `pat` input with sequential
  drum-mapping slots, which also deletes `held`, the stoplight, and the
  debounce outright.
- **Table editing is view + clear only**, not a full in-panel JSON editor —
  entries are only ever created via SNAPSHOT + note capture.

## Constraints

- No build step, no new dependencies — plain additions to `index.html`
  following existing `TYPES`/`COMPONENT_FOR`/template conventions.
- Byte budget: est. +3–4 KB net growth on `index.html` (new module type,
  wrapper, mixin, template, SCHEMA/README doc growth doesn't count against
  the shipped binary).

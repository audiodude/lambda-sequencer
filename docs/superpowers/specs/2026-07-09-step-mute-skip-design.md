# STEP mute & skip states — design

2026-07-09. Approved in brainstorming (visual treatment picked from rendered
mockups: "A1 — hollow mute / hatched skip, yellow hatch when a note is parked").

## Problem

STEP steps are binary (on/off). Two musical gestures are missing:

- **Mute**: silence a note *without losing it*. Today, toggling a step off and
  back on forgets its pitch (repaint assigns `lastPitch`), and the label row
  hides the note while off.
- **Skip**: remove a step from time entirely — the playhead advances past it
  and it consumes no clock tick, shortening the cycle (polymeter / odd-length
  patterns without changing LEN).

Scope: STEP module only. EUCLID untouched.

## Data model

Each step object (`{on, pitch, vel}`) gains one OPTIONAL field:

```js
mode: 'mute' | 'skip'   // absent = normal
```

- Absent key = normal step; the field is only present when set, so patches that
  don't use the feature serialize byte-identically and pre-feature patches load
  with zero migration.
- Mute and skip are mutually exclusive by construction (one field).
- `on`/`pitch`/`vel` keep their exact meanings. A muted step is `on: true` with
  `mode: 'mute'`. A skipped step may be on (note parked underneath) or off.
- When clearing a mode, `delete s.mode` (keeps serialization clean; Vue 3
  proxies observe deletes fine).

Rejected alternatives: two booleans (`mute`/`skip`) allow the meaningless
both-at-once state; replacing `on` with a 4-value enum breaks every existing
patch and `on`-based code path for no user-visible gain.

## Playback semantics (`TYPES.STEP.onInput`)

- **Advance**: on each clk tick, advance `pos` to the next index whose step is
  not `mode === 'skip'`, wrapping within `len`. Guard with one full lap: if all
  `len` steps are skipped, emit nothing and set `m.state.pos = -1` (playhead
  ring hides; no infinite loop).
- **Emit**: only when the landed step is `on` and not muted. (Skipped steps are
  never landed on.)
- A muted step consumes its tick exactly like an off step; timing of the other
  steps is unaffected.
- A pattern with S skipped steps inside LEN cycles in `len - S` ticks — this is
  the point, not a bug.
- Gate length computation (`stepDur` from measured tick interval) unchanged.

## Interaction

| Gesture | Behavior |
|---|---|
| Plain click / drag-paint | Exactly today's on/off paint, and it also clears `mode` on every cell it touches — plain painting always yields plain steps. |
| Alt/Option+click (and drag-paint) | Toggle mute on the anchor cell; the resulting state (mute or normal) paints across the drag. Applies only to `on` steps; off steps are passed over. Alt+click on an off step is a no-op. |
| Shift+click (and drag-paint) | Toggle skip, same anchor-paint pattern. Works on ANY step, empty or not. |
| Right-click | Unchanged: full clear (`on = false`, mode deleted). |
| Scroll wheel | Unchanged: nudges pitch (turning an off step on, as today); never changes `mode`. On a muted/skipped step it edits the kept/parked pitch. |
| Label click (note edit) | Unchanged; works on muted/skipped-with-note steps (`s.on` is true). |
| `«` `»` rotate, `×2` double | Carry `mode` along with each step's `{on, pitch, vel}`. |

Ctrl+click was rejected: on macOS it fires the contextmenu event, which is
already bound (clear step).

## Visuals (mockup-approved)

- **Muted cell**: dark fill (`--bg2`), **2px solid `--note` outline**, opacity
  0.9 — "the note is here, the sound isn't."
- **Skipped cell, no note**: diagonal grey hatch
  (`repeating-linear-gradient(45deg, --bg2 0 4px, --line 4px 7px)`), 1px dashed
  border `#3a4050`, opacity 0.7.
- **Skipped cell with parked note**: same hatch geometry but yellow-tinted
  (`rgba(255,216,74,.38)` stripes, dashed `rgba(255,216,74,.45)` border),
  opacity 0.85.
- **Label row**: muted and skipped-with-note steps show their note name dimmed
  (opacity .5) with `line-through`. The cell says which state; the label says
  which note.
- Playhead ring (`cur`) and LEN tail tick unchanged; the ring never lands on a
  skipped step (falls out of the advance rule).
- Class bindings: cells get `mute` / `skip` (+ existing `on` only when normal-on
  so the yellow fill doesn't fight the hatch); labels get a `struck` class when
  `mode` is set.

## Docs

- SCHEMA.md: document `mode` in the STEP params table (optional, `'mute'` /
  `'skip'`, absent = normal; skipped steps consume no clock tick).
- Module `?` help: one added line for Alt/Shift click.
- README: no change (module-level interactions live in the in-app help).

## Testing (headless, existing smoke-suite pattern)

New `step-mode-smoke.html` harness driving `window.__SEQ`:

1. Build CLOCK→STEP cable; feed synthetic clock events via `app.emit`.
   With skips at known indexes assert the visited `m.state.pos` sequence never
   contains them and the cycle length is `len - S`.
2. Muted step: consumes a tick (pos lands on it) but no note event is emitted
   (spy on `app.emit` for the STEP module's `note` port).
3. All-skipped: N ticks produce no notes, `pos === -1`, no hang.
4. UI: synthetic alt+click sets mute (class + `mode`), shift+click sets skip,
   plain click clears mode, right-click clears all, paint-drag applies to a run.
5. Back-compat: load a pre-feature patch JSON (no `mode` keys) — steps normal,
   no errors; save of an untouched pattern contains no `mode` keys.
6. Standard file:// boot check (no console errors).

Byte budget: est. +2–3 KB on index.html.

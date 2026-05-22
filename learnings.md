# λ-SEQ — Learnings

Things worth remembering for the next "build a whole thing in one shot" session.

## Process

- **Five well-aimed questions beats fifty minutes of guessing.** Asking about (a) what "modular" actually means, (b) sound source, (c) sequencing paradigm, (d) aesthetic, and (e) utility modules eliminated almost every architectural decision before the first line of code. Anything I didn't ask, I had to decide on my own — and those decisions were the ones I sometimes regretted.
- **The user's "look up Ableton 12 Key" aside was the most useful prompt of the session.** Researching prior art on the specific UX they had in mind (global key + scale-aware effects + optional override) translated directly into the KEY-broadcast-with-cable-override design. Don't skip the web search even when you think you already know.
- **Headless Chrome catches what `node --check` doesn't.** Syntax-checking modules passed; the actual page had a TDZ error on first load (EUCLID's `renderRing` declared after the knobs that called it). One `--dump-dom` run with stderr capture surfaced the real bug. Add this step early for browser projects.

## Bugs I shipped

Patterns to recognize next time:

- **Mutating model state after render.** The boot patch set `step.params.steps[i].on = true` AFTER `addModule()` had already rendered cells with `on: false`. The DOM showed empty cells that nonetheless triggered notes. Either mutate params *before* construction or expose a re-render. Don't have two sources of truth pretending not to be.
- **Mixing transient playback state with DOM references in one state object.** Reset-on-play did `Object.assign(state, defaults())` which clobbered `ledEls`/`ringEls` (the DOM refs that render had stashed). Keep playback counters and DOM handles in separate buckets, or reset narrowly (`state.pos = -1`) instead of bulk-resetting.
- **TDZ on factory callbacks.** `const fn = () => {}` declared after a `knob()` factory whose constructor immediately calls `onChange` → ReferenceError before initialization. Function declarations hoist; arrow `const` does not. When something invokes a callback eagerly, anything that callback closes over must already exist.
- **Live drag elements intercepting hit-testing.** The SVG cable being drawn during a patch was eating `elementFromPoint` on the jack underneath. `pointer-events: none` on transient drag elements. Always.
- **Tiny click targets need fuzzy hit-testing.** 16px circular jacks miss `elementFromPoint` constantly. Walking an 8-pixel neighborhood in cardinal+diagonal directions and returning the first `.jack` ancestor turned the patching experience from frustrating to fluid. This is UX, not a workaround.

## Architecture decisions worth keeping

- **Lookahead scheduling tradeoff is real.** 100ms (Chris Wilson "Tale of Two Clocks" default) gives bulletproof timing but makes user-tweaked params (like KEY) feel laggy because future steps are already queued. 35ms is the sweeter spot for an *instrument* where interactive feedback matters more than absolute timing precision. Reach for `output.clear()` if responsiveness must be instant.
- **Software-modular should panic where hardware would pop.** A real eurorack rig held together by patch cables makes ugly noises when you yank a cable mid-play. The software version can fire all-notes-off on any topology change during playback. Don't slavishly emulate the failure modes of the metaphor.
- **Singleton-implicit-with-cable-override pattern.** KEY broadcasts globally to all scale-aware modules with no cable needed (zero-config works), but patching a SCALE cable to a specific QUANT/CHORD overrides locally. Punishes nothing, enables everything. Worth stealing for any "global context with rare per-instance override" situation.
- **Topological eval with a 'ready' check beats explicit topo sort** for a small graph. Walk all modules; evaluate any whose inputs are already resolved; loop with a safety counter. Trivial to implement, no cycle detection needed (yet). Would need a real fixed-point iteration if I added feedback-loop modules (Logic, S&H).
- **Color-coded signal types prevent invalid patches before they happen.** Gate=yellow, pitch=blue, vel=pink, clock=white, scale=purple. The hit-test rejects mismatched signals, but the color cue means users rarely try.

## Things I'd do differently

- **Split UI state from logic state from the start.** I crammed everything into `m.state` and paid for it twice (the reset-clobbers-DOM bug, plus general confusion about what's safe to mutate).
- **Pick a single source of truth for "what's playing" earlier.** I have `activeNotes` (a Set in main), `m._ledEl` flashes, and the scheduler's tick count, but they don't coordinate. A central "voices" registry would let me do precise per-channel note tracking and remove the buckshot all-channels panic.
- **Don't pre-fill demo content via post-render mutation.** Either build it into the module defaults or expose `setParams(p)` that re-renders. The melody-on-boot was a nice idea that became a bug-source.
- **Make cable hit-targets fat from the start.** A second invisible 14px stroke under each visible 5px cable would have prevented the "how do I delete cables" confusion entirely. Standard SVG technique I didn't reach for soon enough.

---

## Iteration 2 — new learnings

### Process

- **Read prior learnings before writing a line of code.** Every bullet from iteration-1 turned into a check I performed *during* writing (TDZ-safe declarations, `pointer-events:none` on the drag cable, fat hit-stroke, narrow reset on play, panic on topology change). The whole file came out clean on first headless run — no debugging-after-the-fact loop. Worth more than any subagent.
- **A single in-page debug handle (`window.__SEQ`) unlocks scripted testing AND devtools poking for free.** `const`/`let` at the top of a `<script>` are script-scoped, not on `window` — a parent frame can't reach `G`, `TR`, `startTransport` etc. without a handle. Costs three lines, pays for itself the first time you want to drive the page from outside or one-liner from devtools. Add it unconditionally at the end of `init()`.
- **Don't waste a question slot on "what does modular mean".** Five questions is a tiny budget; spend them on decisions that *can't* be inferred from context. Sound source, persistence, sequencing style, clock topology — those were load-bearing. The fifth one almost got wasted on "ready to build?" — the user called it out before I could burn it.

### Architecture decisions worth keeping

- **One time base, end to end. Use `performance.now()/1000` everywhere.** WebMIDI's `output.send(data, timestamp)` takes a `performance.now()`-relative millisecond timestamp. `audioCtx.currentTime` is a *different* epoch (seconds since context creation). Mixing them silently drifts. The Chris Wilson "Tale of Two Clocks" post uses AudioContext.currentTime because Web Audio scheduling needs it; for a pure WebMIDI app there's no reason to bring an AudioContext into the picture at all. Pick performance.now and stop thinking about it.
- **Bundle gate+pitch+vel into one "note" event type, not three cables.** Three colored cables per note connection is more CV-purist but makes the patchbay visually noisy and forces every transformer module (transpose, quantize, chance) to have three in/out pairs. A single yellow "note" cable carrying `{pitch, vel, gateLen}` plus the scale purple cable for KEY broadcasts gave a much cleaner UI without losing expressivity. The color-coding still does its job: white=clock, yellow=note, purple=scale.
- **Singleton-by-type via early-return in `addModule`.** CLOCK as a singleton is enforced in one line (`for (const m of G.modules.values()) if (m.type === 'CLOCK') return m;`). Prevents nonsensical patches (two master clocks pulsing in lockstep) without any UI machinery. Apply to any module where N>1 is semantically incoherent.
- **MIDI clock in/out is shockingly little code.** 24 ppqn, status bytes `0xf8` (tick), `0xfa` (start), `0xfc` (stop). 6 ticks per 1/16-note pulse. For OUT: emit 6 `[0xf8]` messages spaced across each scheduled pulse. For IN: count incoming `0xf8` and fire your internal pulse every 6th. Add `0xfa`/`0xfc` handling for transport sync. Total: ~15 lines. Don't skip it — it's what makes a sequencer feel like real gear.

### Things I'd do differently (still)

- **`activeNotes` registry is still vestigial.** I push to it but only use it implicitly via the broadcast all-notes-off panic. If I ever want per-note tracking (mute-while-held, polyphony cap, monophonic legato), this is the place — right now it's dead weight in the MIDI OUT input handler. Either commit to it or rip it out. (Same bullet as last time, still true. The right answer is probably a `voices` Map keyed by `${deviceId}:${ch}:${pitch}` with a scheduled-off timestamp.)
- **Wheel-on-cell for pitch is great; needs a visible affordance.** I added scroll-to-change-pitch on STEP cells, but nothing on screen tells the user. A tooltip on first hover, or a tiny ⇅ glyph in the corner, would have eliminated the discovery problem. The help popover mentions it, but that's a worse UX than letting the cell itself hint.
- **Auto-select the first available MIDI output on access grant.** Currently the user opens the page, sees the default patch, hits PLAY, and nothing happens because MIDI OUT defaults to `(no device)`. Picking the first output by default on first MIDI grant would turn "nothing plays" into "something plays" without taking control away (they can still change it). Tiny win, big first-impression delta.

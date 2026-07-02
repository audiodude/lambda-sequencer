# λ-SEQ — Learnings

Things worth remembering for the next iteration.

## Process

- **Headless Chrome catches what `node --check` doesn't.** Syntax-checking modules passed; the actual page had a TDZ error on first load (EUCLID's `renderRing` declared after the knobs that called it). One `--dump-dom` run with stderr capture surfaced the real bug. Add this step early for browser projects.

## Bugs to avoid

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

---

# Iteration 2 — new learnings

## Process

- **Read prior learnings before writing a line of code.** Every bullet from iteration-1 turned into a check I performed *during* writing. The whole file came out clean on first headless run — no debugging-after-the-fact loop. Worth more than any subagent.
- **A single in-page debug handle (`window.__SEQ`) unlocks scripted testing AND devtools poking for free.** `const`/`let` at the top of a `<script>` are script-scoped, not on `window` — a parent frame can't reach `G`, `TR`, `startTransport` etc. without a handle. Costs three lines, pays for itself the first time you want to drive the page from outside or one-liner from devtools. Add it unconditionally at the end of `init()`.

## Architecture decisions worth keeping

- **One time base, end to end. Use `performance.now()/1000` everywhere.** WebMIDI's `output.send(data, timestamp)` takes a `performance.now()`-relative millisecond timestamp. `audioCtx.currentTime` is a *different* epoch (seconds since context creation). Mixing them silently drifts. The Chris Wilson "Tale of Two Clocks" post uses AudioContext.currentTime because Web Audio scheduling needs it; for a pure WebMIDI app there's no reason to bring an AudioContext into the picture at all. Pick performance.now and stop thinking about it.
- **Bundle gate+pitch+vel into one "note" event type, not three cables.** Three colored cables per note connection is more CV-purist but makes the patchbay visually noisy and forces every transformer module (transpose, quantize, chance) to have three in/out pairs. A single yellow "note" cable carrying `{pitch, vel, gateLen}` plus the scale purple cable for KEY broadcasts gave a much cleaner UI without losing expressivity. The color-coding still does its job: white=clock, yellow=note, purple=scale.

## Things I'd do differently (still)

- **`activeNotes` registry is still vestigial.** I push to it but only use it implicitly via the broadcast all-notes-off panic. If I ever want per-note tracking (mute-while-held, polyphony cap, monophonic legato), this is the place — right now it's dead weight in the MIDI OUT input handler. Either commit to it or rip it out. (Same bullet as last time, still true. The right answer is probably a `voices` Map keyed by `${deviceId}:${ch}:${pitch}` with a scheduled-off timestamp.)
- **Wheel-on-cell for pitch is great; needs a visible affordance.** I added scroll-to-change-pitch on STEP cells, but nothing on screen tells the user. A tooltip on first hover, or a tiny ⇅ glyph in the corner, would have eliminated the discovery problem. The help popover mentions it, but that's a worse UX than letting the cell itself hint.
- **Auto-select the first available MIDI output on access grant.** Currently the user opens the page, sees the default patch, hits PLAY, and nothing happens because MIDI OUT defaults to `(no device)`. Picking the first output by default on first MIDI grant would turn "nothing plays" into "something plays" without taking control away (they can still change it). Tiny win, big first-impression delta.

---

# Viktor NV-1 embed — routing/timing analysis (2026-07-01, pre-implementation)

How sequenced notes will reach the embedded viktor-nv1-engine, and why the shim looks the way it does.

## The two scheduling models

- **λ-SEQ (look-ahead + timestamped handoff).** The transport wakes every 25 ms and emits all events due in the next 35 ms; each note event carries its exact intended play time (`ev.time`, seconds, `performance.now()` domain). MIDI OUT never plays "now" — it hands WebMIDI the bytes with a future timestamp (`out.send(data, onT)`) and the browser/OS delivers at that moment, below main-thread granularity. Note-offs are pre-scheduled at `time + gateLen`. Batched, early arrival is harmless because the timestamps carry the precision.
- **Viktor (play-now).** `dawEngine.externalMidiMessage({data})` was built for live keyboard input: envelopes start at `audioContext.currentTime`, i.e. immediately. There is no "play this at time T" entry point.

## Why not forward events as they arrive

Every note would play up to 35 ms early — and *unevenly* early: events arrive in bursts each time the 25 ms scheduler loop runs, so the note grid would quantize to scheduler wakeups. That's audible jitter, not a constant (correctable) offset.

## The shim: hold each note on a timer until due

`delay = (ev.time - nowSec()) * 1000` (clamp negatives to 0) → `setTimeout` fires note-on via `externalMidiMessage`; a second timer at `delay + gateLen*1000` fires note-off. Residual jitter is ~1–4 ms on a healthy main thread vs a 125 ms sixteenth at 120 BPM — the same timing class as typical browser soft-synths. Chords are free: same-`time` events expire in the same tick; the engine's voice pool absorbs the polyphony. The shim keeps a registry of pending timers + sounding pitches so STOP mirrors the MIDI panic (cancel timers, fire note-offs).

## Known imperfections (accepted for MVP)

- **Main-thread contention** can land timers late (ms typically, tens of ms pathologically). The WebMIDI path is immune to this; the Viktor path isn't.
- **Audio output latency** (~10–30 ms of Web Audio buffering) puts Viktor slightly behind external hardware synths when layered. Physics, not the shim.
- **Byte headroom is spent.** index.html landed at ~1.119 MB against a 1.12 MB working cap (growth ~192 KB, bundle alone 181 KB). The next feature needs its own explicit budget conversation, not an assumption of slack.
- **Gesture-gating leans on Chromium's sticky user activation.** Mid-session engine init often runs from a scheduler timer after a qualifying click elsewhere; Safari would keep the context suspended until the Viktor UI itself is touched. Irrelevant while WebMIDI keeps λ-SEQ Chromium-only — revisit if that changes.

## Upgrade path if setTimeout ever feels loose

Viktor's envelope primitives already accept an explicit start time (`envelope.js:38` — `start(time)` defaults to `currentTime` but takes a parameter), so sample-accurate scheduling is possible — but the time param isn't threaded through `instrument.onMidiMessage → voice.onMidiMessage`, so it means patching call sites inside the vendored engine bundle (giving up bit-faithful vendoring). Phase-2 only if sequenced material audibly suffers.

## Corollary to "one time base, end to end"

Playing "now" on a timer means the two clock domains (`performance.now()` for the sequencer, `AudioContext.currentTime` for the synth) never need converting. The moment two time bases must coexist in one app, immediate-play-on-a-timer sidesteps the epoch-mapping problem entirely; only the fork-based sample-accurate upgrade would need a real domain conversion.

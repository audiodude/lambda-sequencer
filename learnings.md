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
- **Nothing may follow `<component ... />` inside the in-DOM template.** The browser's HTML parser ignores the self-closing slash on non-void elements, so `<component/>` stays open and any sibling written after it parses as its *child* — Vue then treats it as slot content and silently drops it (module components render no default slot). The marquee div rendered nothing until it moved above the `<component>` list: state perfect, computed style perfect, zero warnings, element simply absent.
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
- **Byte headroom is spent.** index.html landed at ~1.119 MB against a 1.12 MB working cap (growth ~192 KB, bundle alone 181 KB). Re-baselined 2026-07-06: ~1.133 MB after multi-Viktor + STEP rotate + fade/choke; treat ~1.15 MB as the new soft cap and keep having the budget conversation per feature.
- **Gesture-gating leans on Chromium's sticky user activation.** Mid-session engine init often runs from a scheduler timer after a qualifying click elsewhere; Safari would keep the context suspended until the Viktor UI itself is touched. Irrelevant while WebMIDI keeps λ-SEQ Chromium-only — revisit if that changes.
- **The engine mixes very hot on headroom, quiet on output: ~-20 dBFS peak for a vel-127 note** at patch master volume (identical chain to the upstream Viktor app, so it's intrinsic — presumably headroom for the 10-voice pool). The shim compensates with `VIKTOR_MAKEUP` (1.8× on the volume slider, ~+5 dB) plus a `DynamicsCompressor` limiter (-3 dB threshold, 20:1) before the destination so stacked voices can't clip. The compressor adds a few ms fixed latency to the Viktor path only. Reverb-heavy patches still sit a couple dB lower: the synthesized impulse carries less energy than upstream's WAV, and tuna's wet/dry law (`dry = 1 - level/2`) leans on the wet path at high levels.
- **Calibrate makeup gain against program material, not the quietest single note.** The first pass set `VIKTOR_MAKEUP` to 3.5× (+11 dB) so one vel-127 Electric Piano note hit -9 dBFS — which guaranteed any real material overshot: factory patches vary several dB per note (Electric Clavessine ≈ +3 dB over Electric Piano), and two coincident voices add ~6 dB, so the demo song's mix measured -11.7 dBFS raw and slammed the output to -2.6 dBFS ("way too hot"). Recalibrated to 1.8× (+5 dB) against the demo mix: output now peaks ≈ -9 dBFS, limiter idle at safety-only duty. Headless measurement idiom: `ScriptProcessor` peak taps on `engine.masterVolume` / `volumeNode` / `limiter` inside the level harness.
- **Chrome's `DynamicsCompressor.reduction` meter is unusable as evidence.** It reads ~-16 dB on *pure silence* (internal adaptive state, not applied reduction) — don't calibrate or debug against it. Sample-accurate peak taps before/after the node are the trustworthy instrument; the node's un-disableable auto-makeup measured +0.8 dB at these settings (-3 dB threshold, 20:1, knee 6).

## Upgrade path if setTimeout ever feels loose

Viktor's envelope primitives already accept an explicit start time (`envelope.js:38` — `start(time)` defaults to `currentTime` but takes a parameter), so sample-accurate scheduling is possible — but the time param isn't threaded through `instrument.onMidiMessage → voice.onMidiMessage`, so it means patching call sites inside the vendored engine bundle (giving up bit-faithful vendoring). Phase-2 only if sequenced material audibly suffers.

## Corollary to "one time base, end to end"

Playing "now" on a timer means the two clock domains (`performance.now()` for the sequencer, `AudioContext.currentTime` for the synth) never need converting. The moment two time bases must coexist in one app, immediate-play-on-a-timer sidesteps the epoch-mapping problem entirely; only the fork-based sample-accurate upgrade would need a real domain conversion.

- **Sharing one AudioContext across engine instances that `new` their own:** upstream `daw.js` calls `new AudioContext()` on the constructor you pass to `NV1.create` — hand it `function () { return sharedCtx; }` and every engine lands on the shared context (a JS constructor returning an object overrides `this`). One context, one limiter, one synthesized reverb impulse buffer shared by N engines; per-engine volume gains splice in before the limiter.
- **The engine fades in for ~2.5s after every `loadPatch`.** Upstream `instrument.js#loadPatch` ducks the instrument's outputNode to 0.01 and recovers with `setTargetAtTime(1.0, t+0.5, 0.5)` — an anti-zipper mute sized for Viktor's own patch browser, not for a sequencer that loads the patch at PLAY. Measured: −40 dB at onset, −4 dB at 1s, full at ~2.5s; both suspicious gain nodes (ours and `engine.masterVolume`) polled flat, which is what localized it to inside the instrument. The shim now cancels the slow ramp after each `loadPatch` and reschedules a fast duck+recover (~0.3s). Debugging note: Chrome's `DynamicsCompressor` was the obvious suspect (its `reduction` meter reads −16 dB on silence) and measured innocent — flat +0.8 dB from the first block. Measure per-stage before blaming the scary-looking node.
- **STOP chokes Viktor.** `viktorPanic` ramps each module's volume gain to 0 (τ=10ms) after the note-offs, cutting releases and delay/reverb tails, mirroring hardware mute rather than MIDI panic. No explicit un-choke needed: `viktorSetVolume` is re-asserted on every note event, so the next play restores the gain inside the 35ms lookahead window.

---

# Same-time event delivery is dependency-ordered (2026-07-03)

Depth-first synchronous `emit()` made *simultaneous* events race on accidents of construction: fan-out followed cable-creation order, and `fireMasterPulse` emitted 1/16 before 1/4. Real casualty: STEP.note → EUCLID.pitch (sample-and-hold), both clocked on the downbeat — EUCLID's tick was often delivered before STEP's, so the downbeat hit played the *previous* pitch and every pitch change landed one event late.

- **A time-sorted event queue alone does NOT fix simultaneity races.** The colliding events carry the identical timestamp; FIFO tie-breaking reproduces the bug exactly. The tie-break is the whole fix.
- Delivery rule now: `emit()` queues; the drain delivers the earliest time bucket only, and within a bucket an event waits while any module *upstream* of its destination (transitively, all cable types) still has a pending delivery — producers settle before the modules they modulate fire. Remaining ties: scale < note < clock, then enqueue order. Cycles in a bucket fall back to enqueue order; a 10k-deliveries guard clears the queue on runaway feedback (previously a stack overflow).
- `fireMasterPulse` batches all port emits for a pulse before draining — otherwise the first port's emit would drain alone and cross-port coincidences could never be reordered.
- Cost: ~4 KB on index.html. Verified by order-smoke harness (same-port adversarial cable order + cross-port 1/16-vs-1/4, plus S&H-holds-between-coincidences), full Viktor suite, clean file:// boot.

# λ-SEQ — Video Scripts

Four scripts: **Hero**, **Deep Dive**, **macOS Tutorial**, **Short/TikTok**.

**Legend:** 🎙️ voiceover · 🖥️ on-screen action · 🔤 text overlay · ♪ music/audio note

**Shared facts (keep consistent across videos):**
- Name: **λ-SEQ** (Lambda Sequencer). By **Travis Briggs**. Free + open source (MIT).
- Lives at **lambda.audiodude.xyz** · source at **github.com/audiodude/lambda-sequencer**.
- It's a single HTML file — runs in a browser tab, no install, works offline. Double-click `index.html` and go.
- It's a **modular MIDI sequencer**: you patch modules with cables; it sends MIDI to any synth (software or hardware). It makes **no sound on its own** — you bring the instruments.
- Modules: **CLOCK** (master clock w/ note-division outs), **DIV** (clock multiply/divide), **STEP** (16-step note sequencer), **EUCLID** (euclidean rhythms), **TRANSPOSE**, **QUANT** (snap/filter to a scale), **CHORD** (scale-aware chords), **CHANCE** (probability), **SCL** (scale source), **MIDI OUT**.
- Patch JSON (SAVE/LOAD PATCH) + **EXPORT APP** (self-contained HTML with the patch baked in).
- The bundled **demo patch** = four voices in **D dorian**, external-clock synced: pad/chords (ch1), arp (ch2), bass (ch3), euclidean pluck (ch4).

---

# 1. Hero

**Goal:** wonder, not a sales pitch. The vibe is "look at this neat thing I made," shown with a maker's quiet pride. Runtime **~1:30**. First person (creator's voice) works well here.
♪ **Bed = λ-SEQ's own demo patch** playing — the music IS the proof.

| Time | 🖥️ On-screen | 🎙️ Voiceover | 🔤 Overlay |
|---|---|---|---|
| 0:00–0:08 | Black. The demo patch's first chord lands; the rack fades up already playing — cables glowing, step LEDs pulsing. | *"So I vibe coded this thing that I've always dreamed about. It's of course not finished yet."* | **λ-SEQ** |
| 0:08–0:18 | Drag `index.html` onto a browser; it opens instantly into the running rack. | *"It's a music sequencer that's is just a web page. One index.html file. Nothing to install, no account, works with the wifi off."* | *one file · no install · offline* |
| 0:18–0:35 | Slow drift across the rack. Drag a cable jack-to-jack; a new line starts firing. | *"You build it out of modules and patch them together with cables — a clock, a sequencer, some rhythm, some chords."* | — |
| 0:35–0:52 | Drop a **CHANCE** module inline → notes start thinning out. Patch **SCL → QUANT** → off notes snap into key. All while it plays. | *"It responds in real time. Add a little randomness here, lock everything to a key there — I never have to stop the music to mess with it. That part still kind of delights me."* | *live-patchable · euclidean · scale-aware* |
| 0:52–1:05 | Cut to Ableton: four tracks lit (pad/arp/bass/pluck), meters moving. Push in on the rack as a full phrase resolves. | *"It doesn't make any sound itself, it just sends MIDI notes. So it sounds like whatever you point it at."* | *(let the music breathe — no VO)* |
| 1:05–1:18 | Click **EXPORT APP**; drag the downloaded file to a new window; it boots up already playing the patch. | *"My favorite trick: you can export the whole instrument including the patch, as a single page you can email to a friend. They double-click it and they're inside your patch."* | *export the whole thing as one file* |
| 1:18–1:30 | Back to the rack, playing. UI softens; title + links rise. Hold the last frame ~2s. | *"Anyway — it's free, it's open, and it's just sitting there at lambda dot audiodude dot xyz. If you make something weird with it, I'd love to see it."* | **λ-SEQ** · **lambda.audiodude.xyz** · *free & open source* |

**Notes for the organic feel:** keep takes slightly imperfect — a small "oops, there" while patching is charming. Avoid imperatives ("click here," "buy now"). End on an invitation, not a CTA.

---

# 2. Deep Dive

**Goal:** teach the mental model by building a patch from nothing. For people who want to actually *get* it. Runtime **~6–8 min**, chaptered. Calmer, screencast pace. ♪ Light/no music under the talking; let the patch itself be the audio as it grows.

### Chapter 0 — Cold open (0:00–0:20)
🖥️ A finished, lush patch playing for a few seconds, then **CLEAR** wipes it to an empty rack.
🎙️ *"That whole thing? We're going to build it from an empty page. Here's how λ-SEQ actually thinks."*

### Chapter 1 — The mental model (0:20–1:10)
🖥️ Empty rack. Hover the palette.
🎙️ *"λ-SEQ is modular. Every module does one small job, and you wire them together with cables. Signals come in three flavors — clock pulses, notes, and scales — and the cable colors tell you which is which. A module only outputs MIDI when it reaches a **MIDI OUT**. Nothing makes sound until then."*
🔤 *clock · note · scale*

### Chapter 2 — Clock + a sequence (1:10–2:20)
🖥️ Add **CLOCK**. Point out its note-division outputs (1, 1/2, 1/4, 1/8, 1/16). Add **STEP**, patch **CLOCK 1/8 → STEP clk**. Add **MIDI OUT**, patch **STEP → MIDI OUT**. Pick a device + channel. Toggle some steps on; draw in pitches; hit play.
🎙️ *"The CLOCK is the heartbeat — and it gives you every note value as a separate output, all locked to the same downbeat. Feed one into a STEP sequencer and it advances a step per pulse. Wire the STEP to a MIDI OUT, pick your instrument's channel… and there's our first line."*
🔤 *CLOCK → STEP → MIDI OUT*

### Chapter 3 — Make it musical: scales & chords (2:20–3:40)
🖥️ Add **SCL**, set root + scale (e.g. D dorian). Add **QUANT**, patch **STEP → QUANT → MIDI OUT** and **SCL → QUANT**. Scribble random pitches; they snap into key. Then add **CHORD** on a second STEP, patch **SCL → CHORD**, show single notes blooming into diatonic chords.
🎙️ *"Now the fun part. A SCALE module broadcasts a key. Send it into QUANT and any wrong note snaps to the nearest scale tone — you literally can't play out of key. Send it into CHORD and single notes bloom into full, in-key chords. One knob changes the whole song's mood."*
🔤 *SCL → QUANT (snap) · SCL → CHORD*

### Chapter 4 — Rhythm & life: EUCLID, DIV, CHANCE (3:40–5:10)
🖥️ Add **EUCLID** (set hits/steps/rotation) → MIDI OUT for a percussive line. Add **DIV** to multiply/divide a clock and drive a faster/slower part. Drop **CHANCE** inline on the arp and lower the probability; notes start dropping out.
🎙️ *"EUCLID spreads a number of hits evenly across a number of steps — instant interlocking grooves. DIV multiplies or divides any clock, so different parts can run at different speeds but stay locked. And CHANCE just… rolls dice on each note. Dial it back and a stiff loop suddenly breathes."*
🔤 *euclidean rhythms · clock division · probability*

### Chapter 5 — Live patching (5:10–6:00)
🖥️ With everything playing, re-patch cables, delete a module, add another — no stops, no glitches.
🎙️ *"And none of this stops the music. Re-patch it, delete a module, add a voice — it keeps playing. That's where it stops feeling like software and starts feeling like an instrument."*

### Chapter 6 — Save, load, export (6:00–6:50)
🖥️ **SAVE PATCH** (JSON). **LOAD PATCH** back. Then **EXPORT APP** → open the standalone file → it boots into the patch.
🎙️ *"Save a patch as a tiny JSON file. Or EXPORT APP, which bakes the whole instrument and your patch into one self-contained HTML file — no server, no dependencies. That file IS the song; you can archive it, share it, open it years from now."*
🔤 *SAVE PATCH · EXPORT APP*

### Chapter 7 — Close (6:50–end)
🖥️ Pull back to the full patch playing.
🎙️ *"It speaks MIDI, so it drives anything — your DAW, a hardware synth, a modular rig. It's free and open source. Go bend it into your own thing."*
🔤 **lambda.audiodude.xyz** · **github.com/audiodude/lambda-sequencer**

> **Note:** a separate macOS tutorial (below) covers IAC + Ableton routing to get actual sound — reference it here with an on-screen card.

---

# 3. macOS Tutorial — IAC + Ableton (get sound)

**Goal:** the absolute barebones path from "nothing" to "I hear notes." Numbered, exact menu paths. Runtime **~3–4 min**. No music bed; clean screencast.

🎙️ Intro: *"λ-SEQ only sends MIDI — it makes no sound on its own. On a Mac, we'll route it through the built-in IAC virtual cable into Ableton, drop a synth on it, and hear it. Five minutes, no extra software."*

### Step 1 — Turn on the IAC virtual cable
🖥️ Open **Audio MIDI Setup** (Spotlight → "Audio MIDI Setup"). Menu **Window → Show MIDI Studio**. Double-click the **IAC Driver** icon. Check **"Device is online."** Note the bus name (e.g. *IAC Driver Bus 1*). Click **Apply**.
🎙️ *"IAC is a virtual MIDI cable that's already on your Mac — it just needs switching on. Audio MIDI Setup, show MIDI Studio, double-click IAC Driver, tick 'Device is online.' That's our pipe between the browser and Ableton."*
🔤 *Audio MIDI Setup → IAC Driver → Device is online*

### Step 2 — Tell Ableton to talk to IAC
🖥️ Ableton **Settings → Link/Tempo/MIDI** (older versions: Preferences → MIDI). Under **MIDI Ports**:
- Find **Output: IAC Driver (Bus 1)** → turn **Sync = On**.
- Find **Input: IAC Driver (Bus 1)** → turn **Track = On**, leave **Sync = Off**.
🎙️ *"In Ableton's MIDI settings: on the IAC **output**, turn Sync on — that sends Ableton's clock to λ-SEQ. On the IAC **input**, turn Track on so Ableton receives the notes coming back. Leave Sync **off** on the input, or you'll get a clock feedback loop on the same cable."*
🔤 *Output IAC: Sync On · Input IAC: Track On, Sync Off*

### Step 3 — Point λ-SEQ at IAC
🖥️ Open λ-SEQ. **LOAD PATCH** → the demo patch. In the **CLOCK** module (EXT mode), pick **IAC Driver Bus 1** as the clock input. (If a "map devices" prompt appears, point it at your IAC bus — it remaps all four outputs + the clock at once.) Confirm each **MIDI OUT** shows IAC on channels **1, 2, 3, 4**.
🎙️ *"In λ-SEQ, load the demo patch. Its clock is set to external, so point it at your IAC bus. If it asks to map devices, just pick your IAC bus once — it fixes all four outputs and the clock together. The four MIDI OUTs are on channels one through four."*
🔤 *LOAD PATCH → CLOCK = IAC · outs = ch 1–4*

### Step 4 — Make four instrument tracks in Ableton
🖥️ Create **4 MIDI tracks**. On each:
- **MIDI From: IAC Driver**, and set the **channel** dropdown to **Ch. 1** (track 2 → Ch. 2, etc.).
- **Monitor: In**.
- Drop any instrument on it (suggested: ch1 warm pad, ch2 bright pluck/lead, ch3 mono bass, ch4 short bell/pluck).
🎙️ *"Four MIDI tracks. Each one: MIDI From IAC Driver, set the channel — one, two, three, four — Monitor to In, and load any instrument. Pad on one, a lead on two, bass on three, a little pluck on four."*
🔤 *4 MIDI tracks · From IAC · Ch 1–4 · Monitor In*

### Step 5 — Press Play (in Ableton)
🖥️ Hit **Play in Ableton**. λ-SEQ's CLOCK flips to EXT and starts chasing; the four tracks light up and you hear the patch.
🎙️ *"Press play in **Ableton** — not λ-SEQ — because Ableton's the clock now. λ-SEQ falls in line, and there's your sound."*
🔤 *Press Play in Ableton ▶*

### Troubleshooting card (hold on screen 10–15s)
🔤
- **No sound?** Track **Monitor = In**, and the **channel** matches the MIDI OUT.
- **Tempo not following?** IAC **output Sync = On** in Ableton; CLOCK set to **EXT** in λ-SEQ.
- **Stuck/double notes or drift?** IAC **input Sync = Off**.
- **Don't want DAW sync?** Switch λ-SEQ's CLOCK to **BPM** and press play in λ-SEQ instead.

🎙️ Outro: *"That's it — IAC on, Ableton talking both directions, instruments on four channels. Same idea works for any DAW or a hardware synth."*

---

# 4. Short / TikTok

**Goal:** stop the scroll, plant the URL. **Vertical 9:16**, **~25s**, music-forward, caption-carried (assume muted autoplay).
♪ The demo patch, punchy. Cut visuals on the beat.

| Time | 🖥️ On-screen (vertical) | 🔤 Overlay |
|---|---|---|
| 0:00–0:03 | First chord hits; rack snaps into view already playing, cables glowing. | **a synth sequencer that runs in a browser tab** |
| 0:03–0:08 | Double-click `index.html` → it opens instantly. | **one file. no install. works offline.** |
| 0:08–0:16 | Fast montage on the beat: patch CLOCK→STEP · drop CHANCE (notes thin out) · SCL→QUANT (notes snap to key). | **patch it live while it plays** |
| 0:16–0:22 | Cut to Ableton: four tracks lighting up; push in on the rack. *(let the music hit)* | **it drives any synth you want** |
| 0:22–0:25 | Freeze on the rack; URL large and centered, held still. | **lambda.audiodude.xyz · free & open source** |

**Caption (post text):** *Built a modular synth sequencer that's just a single HTML file — runs in your browser, no install, sends MIDI to anything. It's free + open source 👇 lambda.audiodude.xyz #synthtok #midi #generativemusic #webaudio #ableton*

**Hooks to A/B test (first 3s text):**
- "a synth sequencer that runs in a browser tab"
- "no app. no install. this is a full sequencer."
- "POV: your next groove is a single HTML file"

---

## Quick production notes (all videos)
- **Reuse the audio:** record the demo patch playing once in Ableton; use it as the bed for Hero + Short, and as proof in the Deep Dive.
- **Two evergreen text frames:** the **λ-SEQ** wordmark and the **URL** — make them once, reuse everywhere.
- **Captions sell it muted** — the 🔤 lines are written to carry each video with no sound.
- **One long patching take** (60–90s) gives all the live-patching B-roll you need for every cut.
- **Always end on the URL held still ~2s** so people can pause and type it.

---

## OBS pan/zoom setup

Two different tools depending on the shot:

**A. Choreographed pan/zooms (Hero, Short, marketing cuts)** — use the free **Move Transition** plugin (by Exeldro). You define two transforms of the same source (a wide framing and a tight/panned one) and animate between them on a hotkey — that smooth, deliberate cinematic push-in.
- https://www.youtube.com/watch?v=EXmf8LN8pJI — "OBS MOVE Transition Tutorial – Make dynamic Zoom presentations"
- https://www.youtube.com/watch?v=dDxuVGZSbXA — "How to add a Zoom Effect in OBS Studio | Move Transition Plugin"

**B. Zoom-follows-cursor (macOS Tutorial, Deep Dive screencasts)** — a zoom-to-mouse plugin tracks the pointer live, so you don't hand-animate.
- https://www.youtube.com/watch?v=IXhrFnlC9AE — "How to Smoothly Zoom & Follow Mouse in OBS Studio (New Plugin)"
- https://www.youtube.com/watch?v=C-wfNpGhzMQ — "OBS Zoom to Your Cursor | Zoom to Mouse Tutorial"

Pick: **Move Transition** for the marketing cuts, **zoom-to-mouse** for the instructional ones. A couple of these videos are from 2021 — the plugin UI shifted slightly but the workflow is the same.

---

## Framing & zoom levels (4K capture → 1080p delivery)

**Core idea:** legibility = how much of the frame a thing fills, *not* the resolution. A 220px module on a 3840px-wide 4K capture is ~6% of the frame; downscale to 1080p and it's still ~6% (~110px). It looks small because you filmed the whole desktop — not because of 4K→1080p. Fix = make the subject fill more of the frame, never "record lower res."

**4K→1080p is a gift:** delivering 1080p from a 4K capture = a **2× punch-in budget with zero quality loss.** Crop any 1920×1080 region out of the 3840×2160 frame and it's still pixel-sharp. That's your pan/zoom headroom — "too small" is fixable in the edit, as long as you **capture at native 4K**.

**Three levers (use before rolling):**
1. **Zoom the app** (easiest — it's a web app): `Cmd +` to 125–150%, and/or the canvas zoom in λ-SEQ's top bar. Frame so the 3–5 relevant modules fill ~60–80% of the screen.
2. **macOS scaling:** System Settings → Displays → Scaled → **"Larger Text."** Chunkier UI, less real estate — good for tutorials.
3. **Crop / punch-in** in OBS (Move Transition / zoom-to-mouse) or in post, spending the 4K budget.

**Legibility targets (in the 1080p master):**
- Smallest readable text ≈ **28–32px tall** (~2.7% of frame height).
- Hero element fills **⅓–½ of frame width.**
- **Vertical Short: double it** — text ≈ **45–50px**, only **1–2 modules on screen**.

**λ-SEQ recipe:** record full screen at **native 4K** → before rolling, zoom λ-SEQ so the relevant modules dominate (don't show the whole rack unless it's a deliberate wide) → edit on a **1080p timeline**, using the 2× headroom for pan/zoom → shoot the Short as separate tight shots, don't just crop the wide.

**Gotcha:** capture the real Retina backing buffer. Confirm OBS canvas/output is your true native res (e.g. 3840×2160), not a scaled "looks-like-1080p" mode, or you lose the punch-in budget.

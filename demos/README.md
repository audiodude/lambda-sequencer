# Demo — Melodic Arp + Chords

A full five-voice arrangement in **D dorian** at **120 BPM**, externally synced to a
DAW. One λ-SEQ scale module feeds every voice, so chords, lead, bass and the
euclidean pluck all stay in key while each runs on its own clock division.

## Files

| File | What it is |
| --- | --- |
| `melodic-arp-chords.json` | The λ-SEQ patch — load this into the sequencer. |
| `melodic-arp-chords.html` | A "frozen" build: the **entire sequencer with this patch baked in**, exported via **EXPORT APP**. Self-contained — just open it in a browser and it boots straight to the patch (no server, no separate load step). |
| `melodic-arp-chords/melodic-arp-chords Project/` | Companion **Ableton Live** set (`.als`) with the five instruments already routed to the channels below. Optional — any DAW or set of synths works. |


## How to run it

1. **Enable the IAC bus.** On macOS open *Audio MIDI Setup → MIDI Studio → IAC
   Driver*, tick **Device is online**, and make sure a port named
   **IAC Driver Bus 1** exists. (Any name works — see note below.)
    * _Alternately, if you're not on a Mac or just don't feel like doing this, λ-SEQ will prompt you, when you open it, to remap IAC Bus 1 -> "Your MIDI Out Whatever"_.
2. **Open the patch.** Either open `melodic-arp-chords.html` (the frozen build —
   it boots straight to the patch, nothing else to load), **or** open λ-SEQ, click
   **LOAD PATCH**, and choose `melodic-arp-chords.json`.
3. **Point your DAW at the bus.** In the DAW, send **MIDI clock** to IAC Bus 1 and
   route its five channels (1, 2, 3, 4, 10) to instruments — or just open the
   included `.als`, which already has them wired up.
4. **Press play in the DAW.** The CLOCK is in external mode, so λ-SEQ starts,
   stops and stays in time with the DAW's transport. There is nothing to start
   inside λ-SEQ itself.


## Signal flow

Everything is driven by one **CLOCK** in external mode (synced to the DAW's MIDI
clock over **IAC Driver Bus 1**) and shares one **SCL** module set to **D dorian**.
The CLOCK's divided outputs (`1`, `1/4`, `1/8`, `1/16`) fan out to each voice.

| Voice | Ch | Clock | Chain | What it plays |
| --- | --- | --- | --- | --- |
| **Chords** | 1 | `1/1` (per bar) | `STEP → CHORD(7th, 4 voices)` | A 4-bar progression: **Dm7 – G7 – Am7 – Cmaj7**, one chord per bar, near-full sustain. |
| **Lead / arp** | 2 | `1/8` | `STEP → CHANCE(80%) → QUANT(snap)` | A 2-bar eighth-note dorian melody, randomly thinned ~20% each pass, snapped to scale. |
| **Bass** | 3 | `1/4` | `STEP` | The chord roots **D – G – A – C**, one per bar, re-struck as staccato quarters. |
| **Pluck** | 4 | `1/16` | `EUCLID(5/16) → QUANT(snap)` | A high sparkle (A4), 5 hits spread over 16 steps, snapped to scale. |
| **Drums** | 10 | mixed | `4 × STEP` | A General-MIDI kit (see below). |

### Drums (channel 10, GM mapping)

| Note | Drum | Pattern | Clock |
| --- | --- | --- | --- |
| 36 | Kick | Four-on-the-floor | `1/4` |
| 38 | Snare | Backbeat (beats 2 & 4) | `1/4` |
| 42 | Closed hi-hat | Busy 16ths with a few gaps | `1/16` |
| 44 | Pedal hi-hat | Accented offbeat eighths | `1/8` |

## Notes

- **Device names are portable.** The patch references the output by name
  (`IAC Driver Bus 1`). If your bus is named differently, λ-SEQ prompts you to map
  it to one of your devices on load; pick it once and every voice is remapped.
- **External sync.** Because the CLOCK is external, tempo follows the DAW — change
  the DAW's BPM and the whole patch follows. The `120` in the patch is only a
  fallback used before the first clock arrives.
- **Make it your own.** Mute voices by disabling a MIDIOUT's input port, swap the
  SCL root/scale to transpose the whole arrangement, or nudge `CHANCE` to make the
  lead busier or sparser.

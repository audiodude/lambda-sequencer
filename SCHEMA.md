# λ-SEQ patch JSON schema

This documents the JSON format used by **SAVE PATCH** / **LOAD PATCH** (and by the
`window.__LAMBDA_BOOT_PATCH__` boot hook that **EXPORT APP** bakes into a
self-contained HTML). The format is produced by `serialize()` and consumed by
`load()` in `index.html`.

A patch is a single JSON object:

```json
{
  "bpm": 120,
  "source": "internal",
  "modules": [ /* Module objects */ ],
  "cables":  [ /* Cable objects  */ ]
}
```

## Top level

| field     | type   | notes |
|-----------|--------|-------|
| `bpm`     | number | Tempo for the internal scheduler. Defaults to `120` if absent. Ignored when slaved to external clock. |
| `source`  | string | `"internal"` or `"external"`. Derived from the CLOCK module's `mode` at runtime (`applyClockParams`); persisted for convenience. |
| `modules` | array  | The modules in the rack. Order is not significant. |
| `cables`  | array  | The patch cables connecting module ports. |

> Legacy field `extClockInId` (top level) is migrated onto the CLOCK module on
> load and should not be written by new patches.

## Module object

```json
{
  "id": 1,
  "type": "CLOCK",
  "x": 20,
  "y": 40,
  "params": { /* type-specific, see below */ },
  "disabled": {}
}
```

| field      | type   | notes |
|------------|--------|-------|
| `id`       | number | Unique within the patch. Cables reference modules by this id. `nextId` is set to `max(id)+1` on load. |
| `type`     | string | One of the module types below. Unknown types are skipped. (`KEY` is a removed legacy type and is dropped on load, along with its cables.) |
| `x`, `y`   | number | Canvas position in unscaled px. Purely cosmetic. |
| `params`   | object | Type-specific settings. Missing keys are filled from that type's `defaults()`, so a partial `params` (even `{}`) is valid. |
| `disabled` | object | Map of disabled ports. Keys are `"in:<port>"` or `"out:<port>"`; value `true` mutes that port (greyed in the UI; signals don't flow through it). Omit or `{}` for none. |

Only **one CLOCK** module is allowed; extra CLOCKs are rejected on add.

## Cable object

```json
{ "from": { "mid": 1, "port": "1/16" },
  "to":   { "mid": 2, "port": "clk"  },
  "type": "clock" }
```

| field  | type   | notes |
|--------|--------|-------|
| `from` | object | `{ mid, port }` — source module id and **output** port name. |
| `to`   | object | `{ mid, port }` — destination module id and **input** port name. |
| `type` | string | Signal type, one of `"clock"`, `"note"`, `"scale"`. Should match the ports' types (used for cable color). |

Back-compat: a `from.port` of `"clk"` on a CLOCK source is rewritten to `"1/16"`.

## Signal types

- **clock** — a pulse `{ kind:'clock', time, idx }`. Drives step advance / gates.
- **note** — `{ kind:'note', time, pitch (0–127), vel (1–127), gateLen (seconds) }`.
- **scale** — `{ kind:'scale', root (0–11), scale (name) }`. Broadcast by SCL.

Ports only connect when types match. Notes are MIDI; middle C = 60 = C3
(Ableton octave numbering).

## Module types — ports & params

Port names are exactly the strings used in `from.port` / `to.port`.

### CLOCK  (master clock; max one)
- **outputs:** `1`, `1/2`, `1/4`, `1/8`, `1/16` (all type `clock`, phase-aligned)
- **inputs:** none
- **params:**
  | key         | type   | default      | notes |
  |-------------|--------|--------------|-------|
  | `mode`      | string | `"internal"` | `"internal"` (use `bpm`) or `"ext"` (chase MIDI clock). |
  | `bpm`       | number | `120`        | Used in internal mode. |
  | `extInId`   | string | `""`         | WebMIDI **input** port id of the external clock. Browser-assigned; resolved from `extInName` on load. |
  | `extInName` | string | `""`         | **Portable** device name (e.g. `"IAC Driver Bus 1"`). Resolved to `extInId` per machine; if unresolved, the device-mapping prompt offers to remap. Prefer setting this. |

### STEP  (step note sequencer)
- **inputs:** `clk` (clock) · **outputs:** `note` (note)
- Advances one step per `clk` tick; emits the step's note if `on`.
- **params:**
  | key       | type   | default | notes |
  |-----------|--------|---------|-------|
  | `steps`   | array  | 16 × `{on:false,pitch:60,vel:100}` | Per-step `{ on:bool, pitch:0-127, vel:1-127 }`. (Step `vel` is currently unused; module `vel` is sent.) |
  | `vel`     | number | `100`   | Velocity sent for active steps. |
  | `gateLen` | number | `0.5`   | Gate as a fraction of the step interval (auto-scales to divided/multiplied clocks). |
  | `len`     | number | `16`    | Pattern length; playback wraps at `len` (use ≤ `steps.length`). |

### EUCLID  (euclidean rhythm)
- **inputs:** `clk` (clock), `pitch` (note) · **outputs:** `note` (note)
- Advances per `clk`; emits its `pitch` on hits of the Bjorklund pattern. A note into `pitch` retunes it.
- **params:** `hits` (4), `steps` (16), `rot` (0), `pitch` (36), `vel` (110), `gateLen` (0.5), `div` (1).

### DIV  (clock divider / multiplier)
- **inputs:** `clk` (clock) · **outputs:** `clk` (clock)
- Output rate = input × (`num`/`den`). Multiplies by spacing extra pulses across the measured input period.
- **params:** `num` (1), `den` (2). (Legacy `ratio` → `{num:1, den:ratio}`.)

### TRANSPOSE
- **inputs:** `in` (note) · **outputs:** `out` (note)
- Adds `semis` to pitch (clamped 0–127).
- **params:** `semis` (0).

### QUANT  (scale quantizer / filter)
- **inputs:** `in` (note), `scl` (scale) · **outputs:** `out` (note)
- `snap`: nearest scale tone. `filter`: pass only notes already in scale.
- **params:** `mode` (`"snap"` | `"filter"`). Needs a `scl` connection (else defaults to C major).

### CHORD  (scale-aware chord builder)
- **inputs:** `in` (note), `scl` (scale) · **outputs:** `out` (note, multiple)
- Quantizes the input to scale, then stacks diatonic scale degrees; emits each note.
- **params:** `type` (`"triad"|"7th"|"sus2"|"sus4"|"9th"`), `voices` (3), `inversion` (0).

### CHANCE  (probability gate)
- **inputs:** `in` (note) · **outputs:** `out` (note)
- Passes each note with probability `prob`%.
- **params:** `prob` (80).

### SCL  (scale source)
- **inputs:** none · **outputs:** `scl` (scale)
- Broadcasts `{ root, scale }` on mount and on change. Patch CHORD/QUANT `scl` inputs from here.
- **params:** `root` (0–11, 0=C), `scale` (`major, minor, dorian, phrygian, lydian, mixolydian, pent-maj, pent-min, chromatic`).

### MIDIOUT  (note → MIDI device)
- **inputs:** `in` (note) · **outputs:** none
- Sends note-on/note-off to the chosen device/channel.
- **params:**
  | key          | type   | default | notes |
  |--------------|--------|---------|-------|
  | `deviceId`   | string | `""`    | WebMIDI **output** port id. Browser-assigned; resolved from `deviceName` on load. |
  | `deviceName` | string | `""`    | **Portable** device name (e.g. `"IAC Driver Bus 1"`). Resolved to `deviceId` per machine; unresolved names trigger the device-mapping prompt. Prefer setting this. |
  | `channel`    | number | `1`     | MIDI channel 1–16. |

### VIKTOR  (built-in Viktor NV-1 synth; max one)
- **inputs:** `in` (note) · **outputs:** none
- Plays notes on the embedded [Viktor NV-1](https://github.com/nicroto/viktor-nv1-engine)
  engine — no MIDI device needed. Audio starts after the first user gesture
  (browser autoplay policy).
- **params:**
  | key         | type   | default            | notes |
  |-------------|--------|--------------------|-------|
  | `patchName` | string | `"Electric Piano"` | Factory patch name (64 available). Unknown names fall back to the default. |
  | `volume`    | number | `0.8`              | Output gain 0–1, applied after the engine's own master volume. |

## Device portability (deviceName / extInName)

WebMIDI assigns each port an opaque `id` that varies by browser, profile, and
origin — so a hardcoded `deviceId`/`extInId` won't bind on another machine.
Patches should therefore set **`deviceName`** (MIDIOUT) and **`extInName`**
(CLOCK) to the human-readable port name. On load, `reconcileDevices()` maps each
name to the local port id. If a name can't be matched and other devices exist, a
modal prompts the user to map it to one of their devices (or skip). Selecting a
device in the UI also captures its name, so saved/exported patches stay portable.

## Minimal example

```json
{
  "bpm": 120,
  "source": "internal",
  "modules": [
    { "id": 1, "type": "CLOCK", "x": 20,  "y": 40, "params": { "mode": "internal", "bpm": 120 }, "disabled": {} },
    { "id": 2, "type": "STEP",  "x": 320, "y": 40, "params": { "len": 4, "vel": 100, "gateLen": 0.5,
        "steps": [ {"on":true,"pitch":60,"vel":100}, {"on":true,"pitch":62,"vel":100},
                   {"on":true,"pitch":64,"vel":100}, {"on":true,"pitch":67,"vel":100} ] }, "disabled": {} },
    { "id": 3, "type": "MIDIOUT", "x": 620, "y": 40,
        "params": { "deviceName": "IAC Driver Bus 1", "deviceId": "", "channel": 1 }, "disabled": {} }
  ],
  "cables": [
    { "from": { "mid": 1, "port": "1/8" },  "to": { "mid": 2, "port": "clk" }, "type": "clock" },
    { "from": { "mid": 2, "port": "note" }, "to": { "mid": 3, "port": "in"  }, "type": "note"  }
  ]
}
```

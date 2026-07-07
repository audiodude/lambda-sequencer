# Drop-in user modules — design spec (2026-07-07)

Let a user load a new module type from a `.js` file at runtime. Once loaded it
behaves like a built-in (palette entry, cables, serialization), and — the key
requirement — **EXPORT APP includes it**, so the exported single-file snapshot
carries the module with it. Addresses issue #1 without giving up the
single-file philosophy: the `.js` file is a *loading* format, not a runtime
dependency; once absorbed, the app is single-file again, including through
export.

## Why this is cheap here

`saveStandalone` doesn't build the export from a template — it serializes the
live DOM (`document.documentElement.outerHTML`) and injects the boot patch
into `<head>`. Anything present in the document at export time ships for free
(the attribution comment at the top of `<head>` already relies on this). So
"embedding" a loaded module means: keep its source in the DOM. The export
code does not change.

## Decisions (proposed)

- **DOM-carried sources.** LOAD MODULE injects the file's source into `<head>`
  as `<script type="text/lambda-module" data-name="NAME">…</script>`. The
  non-executing `type` means the browser never runs it on parse; *we* evaluate
  it at a controlled boot point. Export picks it up automatically.
- **Registration API, versioned.** A module file calls
  `LambdaSeq.registerModule(def)` (global, frozen). One call per file.
- **Patches embed their modules.** SAVE PATCH JSON gains an optional
  `userModules: [{ name, source }]` array so patches stay portable to vanilla
  copies of the app. Loading a patch that references an unknown type with no
  embedded source prompts and skips (mirroring the missing-device modal's
  spirit, but simpler: alert + drop those modules).
- **Builtins can't be shadowed.** Registering a type name that collides with a
  built-in is rejected. Re-registering a *user* type replaces it after a
  `confirm` (existing instances keep running with old `onInput` until reload —
  acceptable; the confirm text says so).

## Module file format

```js
LambdaSeq.registerModule({
  apiVersion: 1,              // rejected if > current API version
  type: 'LFO',                // uppercase, unique; becomes m.type in patches
  label: 'LFO',               // optional palette label (default: type)
  inputs:  [{ name: 'clk', type: 'clock' }],
  outputs: [{ name: 'note', type: 'note' }],
  defaults: () => ({ depth: 12, rate: 4 }),
  onInput(ctx, m, port, ev) { /* same contract as TYPES entries */ },
  component: {                // Vue options object, string template
    template: '<module-frame :module="module" title="LFO" …>…</module-frame>',
    // receives baseProps (module, transport, midiOutputs, midiInputs),
    // must re-emit baseEmits through module-frame as builtins do
  },
});
```

- String templates work because the full Vue build (runtime compiler) is
  already inlined — builtins use `template: '#tmpl-*'` DOM templates, which
  proves the compiler is present.
- `registerModule` does three things: `TYPES[type] = {inputs, outputs,
  defaults, onInput}`, `COMPONENT_FOR[type] = defineComponent({...def.component,
  components: {ModuleFrame, ...}, props: baseProps, emits: baseEmits})`, and
  appends to the palette. Component resolution already goes through
  `componentFor(t)` per render, so no global Vue registration is needed.
- `LambdaSeq` also exposes the helpers a module realistically needs:
  `ModuleFrame`, `clamp`, `quantize`, `noteName`, `secondsPerPulse`. Frozen;
  `apiVersion` bumps when this surface changes shape.

## Loading & boot order

- **LOAD MODULE** button in the top bar next to LOAD PATCH; `<input
  type="file" accept=".js">`, read as text.
- On load: escape every `</script` as `<\/script` (JS-equivalent in the
  string/regex positions where it can legally occur — same idiom
  `saveStandalone` uses for the boot patch), inject the `<script
  type="text/lambda-module">` tag, then evaluate via `new Function(src)()`.
  Registration errors surface in the status bar; a failed module's tag is
  removed so a broken file can't poison future exports.
- **Boot sequence change:** after the core `TYPES`/`COMPONENT_FOR` are defined
  but *before* `createApp` mounts (i.e., before `load()` runs on
  `__LAMBDA_BOOT_PATCH__` / autosave), scan
  `document.querySelectorAll('script[type="text/lambda-module"]')` and
  evaluate each in document order. This is what makes an exported file boot:
  its patch may instantiate user types, so registration must precede patch
  load.
- **Palette reactivity:** the palette is currently a `const PALETTE` array
  referenced by the root template. It moves into (or is wrapped by) reactive
  app state so a post-mount `registerModule` shows up without reload.

## Persistence

- **Autosave:** user-module sources are saved alongside the patch under a new
  localStorage key (`lambda-seq-mods:` + pathname) and re-injected/evaluated
  during the pre-mount scan (DOM tags win over localStorage on exported
  files — same precedence as `__LAMBDA_BOOT_PATCH__` over autosave).
- **SAVE PATCH:** serializer appends `userModules` for any loaded user types
  actually present in the rack (not every loaded module). `importPatch`
  registers embedded modules first, then loads the patch.
- **EXPORT APP:** no code change. The tags are already in `<head>`.

## Managing loaded modules

- A small "MODULES" list (in the help/patch area, not a new page): name,
  instance count, REMOVE. REMOVE is refused while instances of that type exist
  in the rack; otherwise it deletes the DOM tag, the registry entries, and the
  palette entry.

## Trust note

A loaded module is arbitrary JS with full page access — same trust level as
the HTML file itself on the user's machine. But an exported file containing
third-party modules ships that code to whoever opens it. The help overlay's
EXPORT APP blurb gains one line saying exactly that.

## Docs

- `SCHEMA.md`: document `userModules` in the patch format; note that `m.type`
  may name a user-registered type.
- `README.md`: short "Drop-in modules" section — file format, LOAD MODULE,
  the export-carries-modules property, trust note.
- `learnings.md`: anything genuinely learned (likely: serialization escaping,
  palette reactivity).

## Verification (headless harness, existing idiom)

Null-sink headless Chrome, driving `__SEQ`:

1. Load a test module file → palette shows it, instance can be added, cables
   route through its `onInput`, patch save/load round-trips its params.
2. EXPORT APP with the module loaded → open the exported file → module is
   registered pre-patch, the embedded patch's instances boot and run.
3. Module source containing `'</script>'` in a string survives the
   inject → export → reboot round trip.
4. Registering a builtin name (`STEP`) is rejected; re-registering a user
   name replaces after confirm.
5. Patch JSON with `userModules` loads on a vanilla copy (module registered,
   modules instantiated); the same patch minus `userModules` alerts and drops
   the unknown-type modules.
6. Autosave restores loaded modules after reload; REMOVE with zero instances
   deletes tag + registry; REMOVE with instances is refused.
7. Regression: default boot, builtin-only patches, and EXPORT APP without any
   user modules are byte-identical in behavior.

## Constraints

- Core (loader + registry + palette reactivity + docs blurbs) budget:
  ≤ ~4 KB net growth on index.html.
- No build step, no `package.json` — the module file format must be writable
  by hand in a text editor.
- `apiVersion: 1` is the only version; the check exists so version 2 can be
  introduced without silent breakage.

#!/usr/bin/env bash
# Regenerates the vendored Viktor NV-1 engine bundle embedded in index.html
# (the <script> block that defines the NV1 global).
#
# Usage: tools/build-viktor-bundle.sh [outfile]   (default: ./viktor-nv1.bundle.min.js)
#
# Four build-time patches vs upstream — all I/O plumbing, zero DSP changes:
#   1. const.js — blank the reverb impulse path; the app synthesizes the
#      impulse at runtime instead of shipping/fetching a 552 KB WAV.
#   2. tuna.js  — blank the Convolver's fallback impulse path (a blank
#      properties.impulse would otherwise fall through || to an XHR).
#   3. daw.js   — drop midiController.init(); Viktor must not attach to live
#      WebMIDI inputs (1-byte MIDI clock messages make its parser throw, and
#      MIDI-in -> Viktor is out of scope).
#   4. entry    — re-export defaultPatches (NV1.defaultPatches) so the UI can
#      list patch names before any AudioContext exists (pre-gesture).
set -euo pipefail

PIN_COMMIT=50b2c5a80f347e00152daa3771cb83e5ba812feb   # viktor-nv1-engine v2.0.1
REPO=https://github.com/nicroto/viktor-nv1-engine

OUT=$(cd "$(dirname "${1:-viktor-nv1.bundle.min.js}")" && pwd)/$(basename "${1:-viktor-nv1.bundle.min.js}")
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

git clone -q "$REPO" "$WORK/engine"
git -C "$WORK/engine" checkout -q "$PIN_COMMIT"
cd "$WORK/engine"
npm install --omit=dev --silent

# patch 1: no impulse WAV request
perl -pi -e 's{impulse: "impulses/impulse_rev\.wav"}{impulse: ""}' src/daw/engine/const.js
grep -q 'impulse: ""' src/daw/engine/const.js

# patch 2: no fallback impulse XHR
perl -pi -e 's{properties\.impulse \|\| "\.\./impulses/ir_rev_short\.wav"}{properties.impulse || ""}' src/daw/non-npm/tuna/tuna.js
if grep -q 'ir_rev_short' src/daw/non-npm/tuna/tuna.js; then echo "FAIL: tuna fallback impulse not blanked" >&2; exit 1; fi

# patch 3: never attach to live MIDI inputs
perl -ni -e 'print unless /^\s*midiController\.init\(\);\s*$/' src/daw/daw.js
if grep -q 'midiController.init()' src/daw/daw.js; then echo "FAIL: midiController.init() still present" >&2; exit 1; fi

# patch 4: expose the factory patch bank statically
cat > nv1-entry.js <<'EOF'
'use strict';
var api = require('./src/index.js');
module.exports = {
  DAW: api.DAW,
  Synth: api.Synth,
  PatchLibrary: api.PatchLibrary,
  create: api.create,
  defaultPatches: require('./src/patches/defaults'),
};
EOF

npx -y esbuild@0.28.1 nv1-entry.js --bundle --minify --format=iife \
  --global-name=NV1 --outfile=bundle.js >&2

# inline-embed safety: these sequences would terminate the <script> block early
if grep -q '</script' bundle.js; then echo "FAIL: bundle contains </script" >&2; exit 1; fi
if grep -q '<!--' bundle.js; then echo "FAIL: bundle contains <!--" >&2; exit 1; fi
grep -q 'var NV1=' bundle.js

cp bundle.js "$OUT"
echo "wrote $OUT ($(wc -c < "$OUT" | tr -d ' ') bytes, upstream $PIN_COMMIT)" >&2

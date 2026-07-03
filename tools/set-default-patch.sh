#!/usr/bin/env bash
# Replace the embedded DEFAULT_PATCH (the demo song that boots when there is
# no autosave) in a λ-SEQ index.html with a patch exported from the app
# (SAVE button, or copy the JSON from localStorage).
#
# Usage: tools/set-default-patch.sh <patch.json> [index.html]
#   index.html defaults to the repo copy next to this script's parent dir.
set -euo pipefail

PATCH="${1:?usage: set-default-patch.sh <patch.json> [index.html]}"
HTML="${2:-"$(cd "$(dirname "$0")/.." && pwd)/index.html"}"

jq empty "$PATCH" # abort on invalid JSON
if ! jq -e '.modules and (.bpm != null)' "$PATCH" >/dev/null; then
  echo "FAIL: $PATCH does not look like a λ-SEQ patch (needs .bpm and .modules)" >&2
  exit 1
fi
# inline <script> embedding guards, same as the Viktor bundle build
if grep -Eqi '</script|<!--' "$PATCH"; then
  echo "FAIL: patch contains '</script' or '<!--' — unsafe to inline in HTML" >&2
  exit 1
fi
# an EXPORT APP copy boots from its injected __LAMBDA_BOOT_PATCH__, which
# overrides DEFAULT_PATCH — editing it here would change nothing. (The
# source's own saveStandalone() code has "= '" here, an export has "= {".)
if grep -qF '<script>window.__LAMBDA_BOOT_PATCH__ = {' "$HTML"; then
  echo "FAIL: $HTML is an EXPORT APP copy; its boot patch overrides DEFAULT_PATCH. Edit the source index.html instead." >&2
  exit 1
fi

TMP_JSON=$(mktemp)
TMP_HTML=$(mktemp)
trap 'rm -f "$TMP_JSON" "$TMP_HTML"' EXIT
jq . "$PATCH" > "$TMP_JSON"

# Splice: everything from the exact start marker to the first exact end
# marker is the old literal. Emitting the same markers keeps the format
# byte-identical to hand-written style, so re-running stays idempotent.
awk -v patch="$TMP_JSON" '
  BEGIN { MARK_A = "      const DEFAULT_PATCH = {"; MARK_Z = "      };" }
  $0 == MARK_A && !done {
    print
    skip = 1; done = 1
    n = 0
    while ((getline line < patch) > 0) buf[n++] = line
    for (i = 1; i < n - 1; i++) print "      " buf[i]
    print MARK_Z
    next
  }
  skip { if ($0 == MARK_Z) skip = 0; next }
  { print }
  END { if (!done || skip) exit 3 }
' "$HTML" > "$TMP_HTML" || {
  echo "FAIL: DEFAULT_PATCH block not found (or unterminated) in $HTML — nothing changed" >&2
  exit 1
}

# cat (not mv) so the target keeps its permissions/inode
cat "$TMP_HTML" > "$HTML"
echo "OK: replaced DEFAULT_PATCH in $HTML ($(wc -c < "$HTML" | tr -d ' ') bytes)"
echo "NOTE: an existing autosave overrides the default — verify in a fresh profile/private window."

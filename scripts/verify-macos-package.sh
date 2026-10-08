#!/bin/sh
# Registration smoke check only on the disposable macOS Actions runner.
set -eu
[ "$(uname -s)" = Darwin ] && [ "${GITHUB_ACTIONS:-}" = true ] && [ -n "${RUNNER_TEMP:-}" ] || {
  echo 'This package smoke check requires a macOS GitHub Actions runner.' >&2
  exit 1
}
cd "$(dirname "$0")/.."
app="$PWD/release/macos-arm64/pdf.ts.app"
entry="$app/Contents/MacOS/pdf.ts"
codesign --verify --deep --strict "$app"
[ "$("$entry" autostart status)" = disabled ]
# Cleanup also runs if registration or validation fails.
trap '"$entry" autostart disable; "$entry" stop' EXIT HUP INT TERM
"$entry" autostart enable
status=$("$entry" autostart status)
case "$status" in
  enabled|requires-approval) ;;
  *) echo "Unexpected registration status: $status" >&2; exit 1 ;;
esac
"$entry" autostart disable
[ "$("$entry" autostart status)" = disabled ]
# Ordinary commands must still reach the Go launcher through the Swift entry.
"$entry" start
[ "$("$entry" status)" = running ]
"$entry" stop
if "$entry" autostart invalid; then
  echo 'Invalid autostart command unexpectedly succeeded.' >&2
  exit 1
fi
echo 'macOS package verified: signing, login registration, unregister and launcher delegation.'

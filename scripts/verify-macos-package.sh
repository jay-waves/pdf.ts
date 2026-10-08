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
agent="$app/Contents/Library/LaunchAgents/io.github.jay-waves.pdf.ts.agent.plist"
[ -f "$agent" ] && [ -x "$app/Contents/MacOS/pdf-ts-launcher" ] || {
  echo 'Bundled LaunchAgent plist or executable is missing.' >&2
  exit 1
}
plutil -lint "$agent"

check_inactive() {
  status=$("$entry" autostart status)
  echo "Login service status ($1): $status"
  case "$status" in
    disabled|not-found) ;;
    *) echo "Expected an unregistered login service ($1), got: $status" >&2; exit 1 ;;
  esac
}
# Before registration the framework may not yet resolve the service. Validate
# bundled files independently and require successful registration below.
check_inactive 'before registration'
# Cleanup also runs if registration or validation fails.
cleanup() {
  result=$?
  trap - EXIT HUP INT TERM
  "$entry" autostart disable || true
  "$entry" stop || true
  exit "$result"
}
trap cleanup EXIT
trap 'exit 1' HUP INT TERM
echo 'Registering bundled login service'
"$entry" autostart enable
status=$("$entry" autostart status)
echo "Login service status (after registration): $status"
case "$status" in
  enabled|requires-approval) ;;
  *) echo "Unexpected registration status: $status" >&2; exit 1 ;;
esac
"$entry" autostart disable
check_inactive 'after unregister'
# Ordinary commands must still reach the Go launcher through the Swift entry.
"$entry" start
status=$("$entry" status)
if [ "$status" != running ]; then
  echo "Expected a running daemon, got: $status" >&2
  exit 1
fi
"$entry" stop
if "$entry" autostart invalid; then
  echo 'Invalid autostart command unexpectedly succeeded.' >&2
  exit 1
fi
echo 'macOS package verified: signing, login registration, unregister and launcher delegation.'

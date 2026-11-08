#!/bin/sh
# Run pnpm compile, then pnpm package:linux (or package:deb / package:rpm).
# Requires the native launcher and nFPM; PDF_TS_NFPM overrides the packager.
# Packages install file associations and an optional user systemd service.
# Autostart: systemctl --user enable --now pdf.ts.service; disable before removal.
# Uninstall preserves user data; pdf.ts purge removes it explicitly.
set -eu

cd "$(dirname "$0")/.."

format=$1
version=$(node -p "require('./package.json').version")
case "$format" in
  deb) output="release/pdf-ts-${version}-x86_64-unknown-linux-gnu.deb" ;;
  rpm) output="release/pdf-ts-${version}-x86_64-unknown-linux-gnu.rpm" ;;
esac

PDF_TS_VERSION=$version "${PDF_TS_NFPM:-nfpm}" package \
  --config packaging/linux/nfpm.yaml \
  --packager "$format" \
  --target "$output"

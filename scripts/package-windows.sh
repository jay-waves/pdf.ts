#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
repo_root=$PWD

version=$(node -p "require('./package.json').version")
numeric_version=$(printf '%s\n' "$version" | sed -E 's/^([0-9]+(\.[0-9]+){0,2}).*/\1/')
version_quad=$(printf '%s.0.0.0\n' "$numeric_version" | cut -d. -f1-4)

"${PDF_TS_MAKENSIS:-makensis}" \
  "-DAPP_VERSION=$version" \
  "-DAPP_VERSION_QUAD=$version_quad" \
  "-DREPO_ROOT=$repo_root" \
  "-DOUTPUT_FILE=$repo_root/release/pdf-ts-setup-v$version.exe" \
  -V2 \
  packaging/windows/pdf.ts.nsi

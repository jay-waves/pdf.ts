#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
extension_dir="$repo_root/release/vscode/extension"
version="$(node -p "require('$repo_root/package.json').version")"
vsix_path="$repo_root/release/vscode/pdf-ts-vscode-v$version.vsix"
vsce="$repo_root/node_modules/.bin/vsce"

[[ -f "$extension_dir/package.json" ]] || {
  echo 'VS Code build output not found. Run `pnpm build:vscode` first.' >&2
  exit 1
}
[[ -x "$vsce" ]] || {
  echo '@vscode/vsce is not installed. Run `pnpm install` first.' >&2
  exit 1
}

rm -f -- "$vsix_path"
(
  cd -- "$extension_dir"
  "$vsce" package --no-dependencies --skip-license --out "$vsix_path"
)

echo "Created $vsix_path"

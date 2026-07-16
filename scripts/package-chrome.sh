#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="$repo_root/release/chrome/extension"
staging_root="$repo_root/release/chrome/package"
package_name="pdf-ts-chrome-extension"
staging_dir="$staging_root/$package_name"
version="$(node -p "require('$repo_root/package.json').version")"
archive_path="$staging_root/$package_name-v$version.zip"

[[ -d "$build_dir" ]] || {
  echo 'Chrome build output not found. Run `pnpm build:chrome` first.' >&2
  exit 1
}
command -v zip >/dev/null || {
  echo 'The `zip` command is required to package the Chrome extension.' >&2
  exit 1
}

rm -rf -- "$staging_root"
mkdir -p -- "$staging_dir"
cp -a -- "$build_dir"/. "$staging_dir"/

(
  cd -- "$staging_root"
  zip -qr "$archive_path" "$package_name"
)

echo "Created $archive_path"

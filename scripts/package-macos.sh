#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
repo_root=$PWD

arch=$1
binary="$repo_root/release/pdf.ts-darwin-${arch}"

version=$(node -p "require('./package.json').version")
short_version=$(printf '%s\n' "$version" | sed -E -n 's/^([0-9]+(\.[0-9]+){0,2}).*/\1/p')

bundle_parent="$repo_root/release/macos-${arch}"
bundle="$bundle_parent/pdf.ts.app"
contents="$bundle/Contents"
resources="$contents/Resources"
rm -rf "$bundle_parent"
mkdir -p "$contents/MacOS" "$resources"
cp "$binary" "$contents/MacOS/pdf.ts"
chmod 0755 "$contents/MacOS/pdf.ts"
sed \
  -e "s/@@SHORT_VERSION@@/$version/g" \
  -e "s/@@BUNDLE_VERSION@@/$short_version/g" \
  packaging/macos/Info.plist > "$contents/Info.plist"

temporary_directory=$(mktemp -d "${TMPDIR:-/tmp}/pdf-ts-dmg.XXXXXX")
trap 'rm -rf "$temporary_directory"' EXIT HUP INT TERM
iconset="$temporary_directory/pdf-ts.iconset"
mkdir "$iconset"
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" assets/icon.png \
    --out "$iconset/icon_${size}x${size}.png" >/dev/null
done
for pair in '16 32' '32 64' '128 256' '256 512' '512 1024'; do
  set -- $pair
  sips -z "$2" "$2" assets/icon.png \
    --out "$iconset/icon_${1}x${1}@2x.png" >/dev/null
done
iconutil -c icns "$iconset" -o "$resources/pdf-ts.icns"

image_root="$temporary_directory/image"
mkdir "$image_root"
ditto "$bundle" "$image_root/pdf.ts.app"
ln -s /Applications "$image_root/Applications"

output="$repo_root/release/pdf-ts-v${version}-macos-${arch}.dmg"
rm -f "$output"
"${PDF_TS_HDIUTIL:-hdiutil}" create \
  -volname pdf.ts \
  -srcfolder "$image_root" \
  -format UDZO \
  -ov \
  "$output"

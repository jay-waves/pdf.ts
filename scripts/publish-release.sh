#!/usr/bin/env bash
set -Eeuo pipefail

# Called by the tag workflow after every platform has built successfully.
version=$(node -p "require('./package.json').version")
[[ "${GITHUB_REF_NAME:?}" =~ ^v[0-9]+\.[0-9]+\.[0-9]+$ ]]
[[ "$GITHUB_REF_NAME" == "v$version" ]]
series=${version%%.*}
if [[ "$series" == 0 ]]; then
  series=${version%.*}
fi
rolling_tag="v${series}-latest"
source_commit=$(git rev-parse HEAD)

# Skip reruns/backfills of an older release, even if its workflow finishes later.
if git show-ref --verify --quiet "refs/tags/$rolling_tag"; then
  previous_commit=$(git rev-parse "$rolling_tag^{commit}")
  previous_version=$(git show "$previous_commit:package.json" | node -e '
    let input = "";
    for await (const chunk of process.stdin) input += chunk;
    console.log(JSON.parse(input).version);
  ')
  if node -e '
    const a = process.argv[1].split(".").map(Number);
    const b = process.argv[2].split(".").map(Number);
    const index = a.findIndex((value, i) => value !== b[i]);
    process.exit(index >= 0 && a[index] < b[index] ? 0 : 1);
  ' "$version" "$previous_version"; then
    echo "Skipping $version; $rolling_tag already contains $previous_version."
    echo 'published=false' >> "$GITHUB_OUTPUT"
    exit 0
  fi
  if [[ "$previous_commit" != "$source_commit" ]]; then
    if git merge-base --is-ancestor "$source_commit" "$previous_commit"; then
      echo "Skipping older tag $GITHUB_REF_NAME; $rolling_tag already points to a newer commit."
      echo 'published=false' >> "$GITHUB_OUTPUT"
      exit 0
    fi
    git merge-base --is-ancestor "$previous_commit" "$source_commit" || {
      echo 'The rolling release has diverged from this tag; refusing to replace it.' >&2
      exit 1
    }
  fi
fi

shopt -s nullglob
assets=(release/installers/*.deb release/installers/*.rpm release/installers/*.exe release/installers/*.dmg)
[[ ${#assets[@]} -eq 4 ]] || { echo 'Expected exactly four platform installers.' >&2; exit 1; }
expected=(
  "release/installers/pdf-ts-${version}-amd64.deb"
  "release/installers/pdf-ts-${version}-1.x86_64.rpm"
  "release/installers/pdf-ts-setup-v${version}.exe"
  "release/installers/pdf-ts-v${version}-macos-arm64.dmg"
)
for path in "${expected[@]}"; do [[ -s "$path" ]]; done

notes=$(mktemp)
trap 'rm -f "$notes"' EXIT
cat > "$notes" <<NOTES
Latest build for PDF.ts version series $series.

Version: **$GITHUB_REF_NAME**
Source: [$source_commit](https://github.com/$GITHUB_REPOSITORY/tree/$GITHUB_REF_NAME)

Packages: Windows x64, Debian x64, Fedora x64, macOS Apple Silicon.
Native packages are unsigned; the macOS package is not notarized.
NOTES

# List releases successfully before mutating anything (API errors must not look like absence).
release_id=$(gh api --paginate "repos/$GITHUB_REPOSITORY/releases" \
  --jq ".[] | select(.tag_name == \"$rolling_tag\") | .id")
if [[ -z "$release_id" ]]; then
  gh release create "$rolling_tag" --target "$source_commit" --draft \
    --title "PDF.ts $GITHUB_REF_NAME" --notes-file "$notes"
fi

# Upload the complete new set before removing the previous version's attachments.
gh release upload "$rolling_tag" "${assets[@]}" --clobber
asset_names=$(gh release view "$rolling_tag" --json assets --jq '.assets[].name')
while IFS= read -r name; do
  [[ -n "$name" ]] || continue
  keep=false
  for path in "${assets[@]}"; do
    [[ "$name" != "${path##*/}" ]] || keep=true
  done
  if [[ "$keep" == false ]]; then
    gh release delete-asset "$rolling_tag" "$name" --yes
  fi
done <<< "$asset_names"

# The permanent version tag remains untouched; only the release-series alias moves.
git tag --force "$rolling_tag" "$source_commit"
git push origin "refs/tags/$rolling_tag" --force
gh release edit "$rolling_tag" --draft=false --latest=false \
  --title "PDF.ts $GITHUB_REF_NAME" --notes-file "$notes"
echo 'published=true' >> "$GITHUB_OUTPUT"

# Older release series must not replace the current web version.
deploy_pages=true
while IFS= read -r tag; do
  other_series=${tag#v}
  other_series=${other_series%-latest}
  [[ "$other_series" =~ ^[0-9]+(\.[0-9]+)?$ ]] || continue
  if node -e '
    const a = process.argv[1].split(".").map(Number);
    const b = process.argv[2].split(".").map(Number);
    const majorDifference = a[0] - b[0];
    const minorDifference = (a[1] ?? 0) - (b[1] ?? 0);
    process.exit((majorDifference || minorDifference) > 0 ? 0 : 1);
  ' "$other_series" "$series"; then
    deploy_pages=false
  fi
done < <(git tag --list 'v*-latest')
echo "deploy_pages=$deploy_pages" >> "$GITHUB_OUTPUT"

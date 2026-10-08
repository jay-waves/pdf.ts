#!/usr/bin/env bash
set -Eeuo pipefail

# Called by the tag workflow after every platform has built successfully.
version=$(node -p "require('./package.json').version")
[[ "${GITHUB_REF_NAME:?}" == "v$version" ||
   ( "$GITHUB_REF_NAME" == "v$version-"* && "$GITHUB_REF_NAME" =~ -[0-9A-Za-z]+([.-][0-9A-Za-z]+)*$ ) ]]
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

assets=(
  "release/installers/pdf-ts-${version}-x86_64-unknown-linux-gnu.deb"
  "release/installers/pdf-ts-${version}-x86_64-unknown-linux-gnu.rpm"
  "release/installers/pdf-ts-${version}-x86_64-pc-windows.exe"
  "release/installers/pdf-ts-${version}-aarch64-apple-darwin.dmg"
)
for path in "${assets[@]}"; do
  [[ -s "$path" ]] || { echo "Missing or empty installer: $path" >&2; exit 1; }
done

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

# Older release series must not replace Latest or the current web version.
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

# The permanent version tag remains untouched; only the release-series alias moves.
git tag --force "$rolling_tag" "$source_commit"
git push origin "refs/tags/$rolling_tag" --force
gh release edit "$rolling_tag" --draft=false --latest="$deploy_pages" \
  --title "PDF.ts $GITHUB_REF_NAME" --notes-file "$notes"

# A stable patch release retires alpha/beta tags of the preceding patch only.
# Read the remote directly so reruns do not attempt to delete stale local tags.
if [[ "$GITHUB_REF_NAME" == "v$version" ]]; then
  IFS=. read -r major minor patch <<< "$version"
  if (( 10#$patch > 0 )); then
    previous_version="$major.$minor.$((10#$patch - 1))"
    retired_tags=$(git ls-remote --refs --tags origin \
      "refs/tags/v$previous_version-alpha*" \
      "refs/tags/v$previous_version-beta*")
    deletions=()
    leases=()
    while read -r oid ref; do
      [[ -n "$ref" ]] || continue
      deletions+=(":$ref")
      leases+=("--force-with-lease=$ref:$oid")
    done <<< "$retired_tags"
    if (( ${#deletions[@]} > 0 )); then
      git push --atomic "${leases[@]}" origin "${deletions[@]}"
    fi
  fi
fi
echo 'published=true' >> "$GITHUB_OUTPUT"

echo "deploy_pages=$deploy_pages" >> "$GITHUB_OUTPUT"

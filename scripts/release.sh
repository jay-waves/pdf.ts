#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
remote="origin"

usage() {
  echo "Usage: GITHUB_TOKEN=... $0 <tag>" >&2
}

[[ $# -eq 1 ]] || { usage; exit 2; }
release_tag="$1"

[[ -n "${GITHUB_TOKEN:-}" ]] || {
  echo 'GITHUB_TOKEN is required.' >&2
  exit 2
}

git check-ref-format "refs/tags/$release_tag" >/dev/null || {
  echo "Invalid tag: $release_tag" >&2
  exit 2
}

branch="$(git -C "$repo_root" symbolic-ref --quiet --short HEAD)" || {
  echo 'Release must run from a branch, not a detached HEAD.' >&2
  exit 1
}

if [[ -n "$(git -C "$repo_root" status --porcelain)" ]]; then
  echo 'The working tree is not clean. Commit or stash changes before releasing.' >&2
  exit 1
fi

remote_url="$(git -C "$repo_root" remote get-url "$remote")"
[[ "$remote_url" == https://github.com/* ]] || {
  echo "The $remote remote must use an https://github.com/ URL." >&2
  exit 1
}

auth_header="$(printf '%s' "x-access-token:$GITHUB_TOKEN" | base64 | tr -d '\n')"
config_index="${GIT_CONFIG_COUNT:-0}"
[[ "$config_index" =~ ^[0-9]+$ ]] || {
  echo 'GIT_CONFIG_COUNT must be a non-negative integer.' >&2
  exit 1
}
printf -v "GIT_CONFIG_KEY_$config_index" '%s' 'http.https://github.com/.extraheader'
printf -v "GIT_CONFIG_VALUE_$config_index" '%s' "AUTHORIZATION: basic $auth_header"
export "GIT_CONFIG_KEY_$config_index" "GIT_CONFIG_VALUE_$config_index"
export GIT_CONFIG_COUNT="$((config_index + 1))"
unset auth_header

if git -C "$repo_root" rev-parse --verify --quiet "refs/tags/$release_tag"; then
  echo "Tag already exists locally: $release_tag" >&2
  exit 1
fi

if git -C "$repo_root" ls-remote --exit-code --tags "$remote" "refs/tags/$release_tag" >/dev/null; then
  echo "Tag already exists on $remote: $release_tag" >&2
  exit 1
else
  status=$?
  [[ $status -eq 2 ]] || exit "$status"
fi

git -C "$repo_root" tag "$release_tag"
if ! git -C "$repo_root" push --atomic "$remote" \
  "HEAD:refs/heads/$branch" "refs/tags/$release_tag"; then
  git -C "$repo_root" tag --delete "$release_tag" >/dev/null
  echo 'Push failed; the newly created local tag was removed.' >&2
  exit 1
fi

pnpm --dir "$repo_root" deploy:web

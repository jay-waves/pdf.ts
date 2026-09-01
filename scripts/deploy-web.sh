#!/usr/bin/env bash
set -Eeuo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
build_dir="$repo_root/release/web"
worktree_dir="$repo_root/release/.pages-worktree"
temporary_branch="pages-deploy-$$-$(date +%s)"
remote="origin"
branch="gh-pages"
dry_run=false
worktree_added=false

while (($#)); do
  case "$1" in
    --remote)
      [[ $# -ge 2 ]] || { echo 'Missing value for --remote.' >&2; exit 2; }
      remote="$2"
      shift 2
      ;;
    --branch)
      [[ $# -ge 2 ]] || { echo 'Missing value for --branch.' >&2; exit 2; }
      branch="$2"
      shift 2
      ;;
    --dry-run)
      dry_run=true
      shift
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
done

cleanup() {
  if [[ "$worktree_added" == true ]]; then
    git -C "$repo_root" worktree remove --force "$worktree_dir" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$worktree_dir"
  git -C "$repo_root" branch -D "$temporary_branch" >/dev/null 2>&1 || true
}
trap cleanup EXIT

if [[ "$dry_run" == false ]]; then
  git -C "$repo_root" remote get-url "$remote" >/dev/null
fi

source_revision="$(git -C "$repo_root" rev-parse --short HEAD)"
pnpm --dir "$repo_root" compile

[[ -f "$build_dir/index.html" ]] || {
  echo 'Web build did not produce release/web/index.html.' >&2
  exit 1
}

git -C "$repo_root" worktree prune
if [[ -e "$worktree_dir" ]]; then
  git -C "$repo_root" worktree remove --force "$worktree_dir" >/dev/null 2>&1 || true
  rm -rf -- "$worktree_dir"
fi

git -C "$repo_root" worktree add --detach "$worktree_dir" HEAD
worktree_added=true
git -C "$worktree_dir" switch --orphan "$temporary_branch"

shopt -s dotglob nullglob
for path in "$worktree_dir"/*; do
  [[ "$(basename -- "$path")" == '.git' ]] || rm -rf -- "$path"
done
shopt -u dotglob nullglob

cp -a -- "$build_dir"/. "$worktree_dir"/
: > "$worktree_dir/.nojekyll"
git -C "$worktree_dir" add --all
git -C "$worktree_dir" commit -m "Deploy web viewer from $source_revision"

if [[ "$dry_run" == true ]]; then
  echo 'Dry run completed; the temporary deployment commit was not pushed.'
else
  git -C "$worktree_dir" push --force "$remote" "HEAD:$branch"
  echo "Deployed release/web to $remote/$branch with a single orphan commit."
fi

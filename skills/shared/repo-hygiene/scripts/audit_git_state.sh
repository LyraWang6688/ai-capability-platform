#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [--repo DIR] [--] [RELATIVE_PATH ...]" >&2
}

repo="."
while (($#)); do
  case "$1" in
    --repo)
      (($# >= 2)) || { usage; exit 64; }
      repo=$2
      shift 2
      ;;
    --)
      shift
      break
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -*)
      echo "ERROR: unknown option: $1" >&2
      usage
      exit 64
      ;;
    *)
      break
      ;;
  esac
done

root=$(git -C "$repo" rev-parse --show-toplevel 2>/dev/null) || {
  echo "ERROR: not a Git working tree: $repo" >&2
  exit 2
}

branch=$(git -C "$root" branch --show-current)
head=$(git -C "$root" rev-parse --short HEAD)
upstream=$(git -C "$root" rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' 2>/dev/null || true)
worktree_count=$(git -C "$root" worktree list --porcelain | awk '$1 == "worktree" { count++ } END { print count+0 }')

echo "REPOSITORY_ROOT=$root"
echo "BRANCH=${branch:-DETACHED}"
echo "HEAD=$head"
echo "UPSTREAM=${upstream:-NONE}"
echo "WORKTREE_COUNT=$worktree_count"

if [[ -n "$upstream" ]]; then
  counts=$(git -C "$root" rev-list --left-right --count "$upstream...HEAD")
  behind=${counts%%[[:space:]]*}
  ahead=${counts##*[[:space:]]}
  echo "BEHIND=$behind"
  echo "AHEAD=$ahead"
else
  echo "BEHIND=UNKNOWN"
  echo "AHEAD=UNKNOWN"
fi

status=$(git -C "$root" status --short --untracked-files=all)
if [[ -n "$status" ]]; then
  echo "REPOSITORY_STATUS=DIRTY"
  printf '%s\n' "$status" | sed 's/^/STATUS\t/'
else
  echo "REPOSITORY_STATUS=CLEAN"
fi

if (($# == 0)); then
  exit 0
fi

for rel in "$@"; do
  if [[ -z "$rel" || "$rel" = /* || "$rel" = "." || "$rel" = ".." || "$rel" = ../* || "$rel" = */../* || "$rel" = */.. ]]; then
    printf 'PATH\t%s\tINVALID\n' "$rel"
    continue
  fi

  abs="$root/$rel"
  exists=no
  kind=missing
  if [[ -L "$abs" ]]; then
    exists=yes
    kind=symlink
  elif [[ -d "$abs" ]]; then
    exists=yes
    kind=directory
  elif [[ -f "$abs" ]]; then
    exists=yes
    kind=file
  elif [[ -e "$abs" ]]; then
    exists=yes
    kind=other
  fi

  tracked=no
  [[ -n "$(git -C "$root" ls-files -- "$rel")" ]] && tracked=yes

  ignored=no
  if git -C "$root" check-ignore -q -- "$rel" 2>/dev/null || git -C "$root" check-ignore -q -- "$rel/" 2>/dev/null; then
    ignored=yes
  fi

  path_status=$(git -C "$root" status --porcelain=v1 --untracked-files=all -- "$rel")
  changed=no
  [[ -n "$path_status" ]] && changed=yes

  printf 'PATH\t%s\texists=%s\ttype=%s\ttracked=%s\tignored=%s\tchanged=%s\n' \
    "$rel" "$exists" "$kind" "$tracked" "$ignored" "$changed"
  if [[ -n "$path_status" ]]; then
    printf '%s\n' "$path_status" | sed 's/^/PATH_STATUS\t/'
  fi
done

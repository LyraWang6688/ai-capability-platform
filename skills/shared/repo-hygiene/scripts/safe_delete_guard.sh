#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 [--repo DIR] -- RELATIVE_PATH [...]" >&2
  echo "Read-only guard: it never deletes anything." >&2
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
    *)
      echo "ERROR: expected -- before paths" >&2
      usage
      exit 64
      ;;
  esac
done

(($# > 0)) || { usage; exit 64; }

root=$(git -C "$repo" rev-parse --show-toplevel 2>/dev/null) || {
  echo "ERROR: not a Git working tree: $repo" >&2
  exit 2
}

blocked=0
for rel in "$@"; do
  reason=""
  if [[ -z "$rel" || "$rel" = /* || "$rel" = "." || "$rel" = ".." || "$rel" = ../* || "$rel" = */../* || "$rel" = */.. ]]; then
    reason="unsafe or non-relative path"
  elif [[ "$rel" = ".git" || "$rel" = .git/* || "$rel" = */.git || "$rel" = */.git/* ]]; then
    reason="Git metadata is protected"
  elif [[ "$rel" = ".env" || "$rel" = .env.* || "$rel" = */.env || "$rel" = */.env.* ]]; then
    reason="environment and secret files require manual handling"
  fi

  abs="$root/$rel"
  if [[ -z "$reason" && ! -e "$abs" && ! -L "$abs" ]]; then
    printf 'PASS\t%s\talready absent (idempotent)\n' "$rel"
    continue
  fi
  if [[ -z "$reason" && -L "$abs" ]]; then
    reason="symlink targets are not resolved by this guard"
  fi
  if [[ -z "$reason" && -e "$abs/.git" ]]; then
    reason="candidate contains nested Git/worktree metadata"
  fi
  if [[ -z "$reason" && -n "$(git -C "$root" ls-files -- "$rel")" ]]; then
    reason="candidate contains tracked content"
  fi
  if [[ -z "$reason" ]]; then
    path_status=$(git -C "$root" status --porcelain=v1 --untracked-files=all -- "$rel")
    if [[ -n "$path_status" && "$path_status" != '?? '* ]]; then
      reason="candidate has staged or modified Git state"
    fi
  fi
  if [[ -z "$reason" ]]; then
    if ! git -C "$root" check-ignore -q -- "$rel" 2>/dev/null && ! git -C "$root" check-ignore -q -- "$rel/" 2>/dev/null; then
      reason="candidate is visible untracked content, not ignored"
    fi
  fi

  if [[ -n "$reason" ]]; then
    printf 'BLOCK\t%s\t%s\n' "$rel" "$reason"
    blocked=1
  else
    printf 'PASS\t%s\tdeterministic checks passed; semantic DELETE classification and human approval still required\n' "$rel"
  fi
done

if ((blocked)); then
  exit 1
fi

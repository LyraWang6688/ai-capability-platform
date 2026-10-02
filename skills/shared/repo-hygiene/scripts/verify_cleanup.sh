#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: verify_cleanup.sh [--repo DIR] [--absent PATH] [--present PATH]
                         [--ignored PATH] [--clean]
At least one assertion is required. Paths are repository-relative.
EOF
}

repo="."
# A sentinel avoids Bash 3.2 treating an empty declared array as unset under `set -u`.
declare -a absent=("") present=("") ignored=("")
require_clean=0
assertions=0

while (($#)); do
  case "$1" in
    --repo)
      (($# >= 2)) || { usage; exit 64; }
      repo=$2
      shift 2
      ;;
    --absent)
      (($# >= 2)) || { usage; exit 64; }
      absent+=("$2")
      assertions=$((assertions + 1))
      shift 2
      ;;
    --present)
      (($# >= 2)) || { usage; exit 64; }
      present+=("$2")
      assertions=$((assertions + 1))
      shift 2
      ;;
    --ignored)
      (($# >= 2)) || { usage; exit 64; }
      ignored+=("$2")
      assertions=$((assertions + 1))
      shift 2
      ;;
    --clean)
      require_clean=1
      assertions=$((assertions + 1))
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "ERROR: unknown option: $1" >&2
      usage
      exit 64
      ;;
  esac
done

((assertions > 0)) || { usage; exit 64; }

root=$(git -C "$repo" rev-parse --show-toplevel 2>/dev/null) || {
  echo "ERROR: not a Git working tree: $repo" >&2
  exit 2
}

validate_rel() {
  local rel=$1
  [[ -n "$rel" && "$rel" != /* && "$rel" != "." && "$rel" != ".." && "$rel" != ../* && "$rel" != */../* && "$rel" != */.. ]]
}

failed=0
for rel in "${absent[@]}"; do
  [[ -n "$rel" ]] || continue
  if ! validate_rel "$rel"; then
    printf 'FAIL\tabsent\t%s\tinvalid relative path\n' "$rel"
    failed=1
  elif [[ -e "$root/$rel" || -L "$root/$rel" ]]; then
    printf 'FAIL\tabsent\t%s\tstill exists\n' "$rel"
    failed=1
  else
    printf 'PASS\tabsent\t%s\n' "$rel"
  fi
done

for rel in "${present[@]}"; do
  [[ -n "$rel" ]] || continue
  if ! validate_rel "$rel"; then
    printf 'FAIL\tpresent\t%s\tinvalid relative path\n' "$rel"
    failed=1
  elif [[ -e "$root/$rel" || -L "$root/$rel" ]]; then
    printf 'PASS\tpresent\t%s\n' "$rel"
  else
    printf 'FAIL\tpresent\t%s\tmissing\n' "$rel"
    failed=1
  fi
done

for rel in "${ignored[@]}"; do
  [[ -n "$rel" ]] || continue
  if ! validate_rel "$rel"; then
    printf 'FAIL\tignored\t%s\tinvalid relative path\n' "$rel"
    failed=1
  elif git -C "$root" check-ignore -q -- "$rel" 2>/dev/null; then
    printf 'PASS\tignored\t%s\n' "$rel"
  else
    printf 'FAIL\tignored\t%s\tnot ignored\n' "$rel"
    failed=1
  fi
done

if ! git -C "$root" diff --check; then
  echo $'FAIL\tdiff-check\trepository'
  failed=1
else
  echo $'PASS\tdiff-check\trepository'
fi

if ((require_clean)); then
  status=$(git -C "$root" status --short --untracked-files=all)
  if [[ -n "$status" ]]; then
    echo $'FAIL\tclean\trepository has changes'
    printf '%s\n' "$status" | sed 's/^/STATUS\t/'
    failed=1
  else
    echo $'PASS\tclean\trepository'
  fi
fi

if ((failed)); then
  exit 1
fi

#!/usr/bin/env bash
# Deterministic offline tests for the store-publish scripts.
# No network, no writes to the real Store: everything runs against a fixture.
set -euo pipefail

# Keep the skill directory clean: importing store_root would otherwise drop a
# __pycache__/ next to the scripts.
export PYTHONDONTWRITEBYTECODE=1

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
# $TMPDIR on macOS carries a trailing slash; strip it so path comparisons match.
tmpbase="${TMPDIR:-/tmp}"
tmpbase="${tmpbase%/}"
fixture=$(mktemp -d "$tmpbase/store-publish-test.XXXXXX")
trap 'rm -rf -- "$fixture"' EXIT

store="$fixture/store"
mkdir -p "$store/skills" "$store/external-capabilities" "$store/dependencies"

cat > "$store/registry.yaml" <<'YAML'
schema_version: 2
store:
  name: ai-capability-store
  owner: tester
registries:
  skills: skills/registry.yaml
  external_capabilities: external-capabilities/registry.yaml
  dependencies: dependencies/capability-map.yaml
YAML

cat > "$store/skills/registry.yaml" <<'YAML'
schema_version: 2
skills:
  demo-skill:
    name: demo-skill
    path: skills/demo-skill
    scope: shared
    status: testing
    version: 0.1.0
    updated: "2026-10-03"
YAML

cat > "$store/external-capabilities/registry.yaml" <<'YAML'
schema_version: 1
capabilities:
  demo-mcp:
    name: demo-mcp
    provider: tester
    type: mcp
    status: limited
    version: 0.1.0
    implementation_path: external-capabilities/mcp/demo-mcp
    provider_path: external-capabilities/providers/tester/README.md
YAML

cat > "$store/dependencies/capability-map.yaml" <<'YAML'
schema_version: 1
dependencies: []
YAML

pass=0
fail=0
expect() {  # expect <wanted-exit> <label> <command...>
  local want=$1 label=$2; shift 2
  local got=0
  "$@" >/dev/null 2>&1 || got=$?
  if [[ "$got" == "$want" ]]; then
    echo "  ok   $label (exit $got)"; pass=$((pass + 1))
  else
    echo "  FAIL $label: wanted exit $want, got $got" >&2; fail=$((fail + 1))
  fi
}

export AI_CAPABILITY_STORE="$store"
PY=${PYTHON:-python3}

echo "store_root.py"
expect 0 "locates the Store from \$AI_CAPABILITY_STORE" \
  "$PY" "$script_dir/store_root.py"
resolved=$("$PY" "$script_dir/store_root.py")
if [[ "$resolved" == "$store" ]]; then
  echo "  ok   resolved the expected path"; pass=$((pass + 1))
else
  echo "  FAIL resolved '$resolved', expected '$store'" >&2; fail=$((fail + 1))
fi

echo "reuse_scan.py"
expect 10 "flags an already-registered skill" "$PY" "$script_dir/reuse_scan.py" demo-skill
expect 10 "flags an already-registered capability" "$PY" "$script_dir/reuse_scan.py" demo-mcp
expect 0  "passes a brand-new name" "$PY" "$script_dir/reuse_scan.py" brand-new-thing
expect 10 "mixed batch fails if any name exists" \
  "$PY" "$script_dir/reuse_scan.py" brand-new-thing demo-skill
expect 0  "--all lists a populated registry" "$PY" "$script_dir/reuse_scan.py" --all
expect 2  "refuses to run with no arguments" "$PY" "$script_dir/reuse_scan.py"

echo "reuse_scan.py — unreadable Store"
broken="$fixture/broken"
mkdir -p "$broken/skills" "$broken/external-capabilities" "$broken/dependencies"
printf 'schema_version: 2\n' > "$broken/registry.yaml"
printf 'schema_version: 2\n' > "$broken/skills/registry.yaml"
printf 'schema_version: 1\n' > "$broken/external-capabilities/registry.yaml"
printf 'schema_version: 1\n' > "$broken/dependencies/capability-map.yaml"
AI_CAPABILITY_STORE="$broken" "$PY" "$script_dir/reuse_scan.py" anything >/dev/null 2>&1 \
  && { echo "  FAIL a router with no 'registries' mapping was accepted" >&2; fail=$((fail + 1)); } \
  || { echo "  ok   rejects a router with no 'registries' mapping"; pass=$((pass + 1)); }

echo
if ((fail > 0)); then
  echo "FAIL: $fail of $((pass + fail)) checks failed" >&2
  exit 1
fi
echo "PASS: store-publish script tests ($pass checks)"

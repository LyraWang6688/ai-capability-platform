#!/usr/bin/env python3
"""
Platform Validator — deterministic structural checks
for the Personal AI Capability Platform.

Principle:
    LLM   does semantic judgment
    Script does deterministic protection
    Human does high-risk authorization

This validator NEVER:
    - judges whether a skill is good
    - auto-promotes lifecycle
    - modifies files
    - publishes anything
    - deletes resources

Checks:
    1. top-level registry parses (YAML, schema_version == 1)
    2. referenced registries exist (skills / external_capabilities / dependencies)
    3. referenced registry paths are not duplicated
    4. skill lifecycle status is legal (allowed_statuses)
    5. external capability status / type are legal
    6. registered paths exist on disk
    7. basic naming compliance (lowercase kebab-case)
    8. required policy files exist
    9. lightweight secret scan on registry files

Usage:
    python3 scripts/validate_platform.py
Exit code 0 = all checks pass; non-zero = failure.
"""

import os
import re
import sys

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.stderr.write("ERROR: PyYAML is required (pip install pyyaml)\n")
    sys.exit(2)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

ALLOWED_SKILL_STATUSES = {"draft", "testing", "active", "deprecated", "archived"}
ALLOWED_CAPABILITY_TYPES = {"plugin", "mcp", "connector", "cli", "external-api", "integration"}
ALLOWED_CAPABILITY_STATUSES = {"available", "limited", "disabled", "unknown"}
KEBAB_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

REQUIRED_POLICY_FILES = [
    "AGENTS.md",
    "CONTRIBUTING_AI.md",
    "registry.yaml",
    "skills/README.md",
    "skills/registry.yaml",
    "skills/LIFECYCLE.md",
    "skills/VERSIONING.md",
    "skills/ACCEPTANCE.md",
    "external-capabilities/README.md",
    "external-capabilities/registry.yaml",
    "external-capabilities/SECURITY.md",
    "dependencies/capability-map.yaml",
    "tests/README.md",
    "scripts/validate_platform.py",
]

# Key names that indicate a possible secret value (case-insensitive).
SECRET_KEY_RE = re.compile(
    r"(?i)(api[_-]?key|secret|token|password|client[_-]?secret|credential|cookie)"
)
# Heuristic: an actual-looking secret value (>= 12 chars, not a placeholder/doc string).
SECRET_VALUE_RE = re.compile(r"^[A-Za-z0-9_\-./+]{12,}$")

checks: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    checks.append((name, ok, detail))


def load_yaml(rel_path: str):
    path = os.path.join(ROOT, rel_path)
    if not os.path.exists(path):
        check(f"exists: {rel_path}", False, "file not found")
        return None
    try:
        with open(path, encoding="utf-8") as fh:
            return yaml.safe_load(fh)
    except Exception as exc:  # noqa: BLE001
        check(f"parse: {rel_path}", False, str(exc))
        return None


def scan_for_secrets(rel_path: str) -> None:
    """Scan registry/data files for key: value patterns that look like real secrets."""
    path = os.path.join(ROOT, rel_path)
    if not os.path.exists(path) or not rel_path.endswith((".yaml", ".yml", ".json")):
        return
    try:
        with open(path, encoding="utf-8") as fh:
            lines = fh.readlines()
    except OSError:
        return
    hits = []
    for lineno, line in enumerate(lines, start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        m = re.match(r"^([A-Za-z0-9_\-]+)\s*[:=]\s*[\"']?([^\"'\s,}]+)", stripped)
        if not m:
            continue
        key, value = m.group(1), m.group(2)
        if SECRET_KEY_RE.search(key) and SECRET_VALUE_RE.match(value):
            if value.lower() not in ("null", "none", "true", "false", "example", "xxx", "placeholder"):
                hits.append(f"{rel_path}:{lineno} ({key})")
    check(f"secret scan: {rel_path}", not hits, "; ".join(hits) if hits else "clean")


def walk_map_entries(data, container_key):
    """Return list of dict entries from a mapping keyed by name -> entry dict."""
    entries = []
    if not isinstance(data, dict):
        return entries
    for name, entry in (data.get(container_key) or {}).items():
        if isinstance(entry, dict):
            entries.append((name, entry))
        else:
            entries.append((name, {}))
    return entries


def main() -> int:
    # 1. Top-level registry parses.
    top = load_yaml("registry.yaml")
    if top is None:
        return report(1)
    check("top-level registry schema_version", top.get("schema_version") == 1,
          f"got {top.get('schema_version')!r}")
    check("top-level platform name", top.get("platform", {}).get("name") == "personal-ai-capability-platform",
          repr(top.get("platform", {}).get("name")))
    check("top-level platform owner", top.get("platform", {}).get("owner") == "LyraWang6688",
          repr(top.get("platform", {}).get("owner")))

    # 2. Referenced registries exist and 3. are not duplicated.
    refs = (top.get("registries") or {})
    expected_refs = {"skills", "external_capabilities", "dependencies"}
    check("top-level registry routes all domains", set(refs.keys()) == expected_refs,
          f"routes: {sorted(refs.keys())}")
    ref_paths = [p for p in refs.values() if isinstance(p, str)]
    check("registry paths not duplicated", len(ref_paths) == len(set(ref_paths)),
          "duplicate registry path in top-level registries")
    for domain, rel in refs.items():
        if isinstance(rel, str):
            check(f"referenced registry exists: {rel}", os.path.exists(os.path.join(ROOT, rel)),
                  "file not found")

    # 4. Skill lifecycle status legal.
    skills_reg = load_yaml("skills/registry.yaml")
    if skills_reg is not None:
        allowed = set(skills_reg.get("allowed_statuses") or [])
        check("skills registry keeps 5 lifecycle statuses", allowed == ALLOWED_SKILL_STATUSES,
              f"allowed={sorted(allowed)}")
        for name, entry in walk_map_entries(skills_reg, "projects"):
            status = entry.get("status")
            check(f"skill status legal: {name}", status in ALLOWED_SKILL_STATUSES, f"status={status!r}")
        for name, entry in walk_map_entries(skills_reg, "shared"):
            status = entry.get("status")
            check(f"skill status legal: {name}", status in ALLOWED_SKILL_STATUSES, f"status={status!r}")

    # 5. External capability status / type legal.
    caps_reg = load_yaml("external-capabilities/registry.yaml")
    if caps_reg is not None:
        allowed_types = set(caps_reg.get("allowed_types") or [])
        allowed_statuses = set(caps_reg.get("allowed_statuses") or [])
        check("capability registry supports 6 types", allowed_types == ALLOWED_CAPABILITY_TYPES,
              f"types={sorted(allowed_types)}")
        check("capability registry keeps 4 statuses", allowed_statuses == ALLOWED_CAPABILITY_STATUSES,
              f"statuses={sorted(allowed_statuses)}")
        for name, entry in walk_map_entries(caps_reg, "capabilities"):
            status = entry.get("status")
            check(f"capability status legal: {name}", status in ALLOWED_CAPABILITY_STATUSES,
                  f"status={status!r}")
            ctype = entry.get("type")
            if ctype is not None:
                check(f"capability type legal: {name}", ctype in ALLOWED_CAPABILITY_TYPES,
                      f"type={ctype!r}")

    # 6. Registered paths exist on disk.
    for name, entry in walk_map_entries(skills_reg if skills_reg is not None else {}, "projects"):
        path = entry.get("path")
        if path:
            check(f"registered skill path exists: {name}", os.path.exists(os.path.join(ROOT, path)),
                  f"path={path!r}")
    for name, entry in walk_map_entries(skills_reg if skills_reg is not None else {}, "shared"):
        path = entry.get("path")
        if path:
            check(f"registered skill path exists: {name}", os.path.exists(os.path.join(ROOT, path)),
                  f"path={path!r}")
    for name, entry in walk_map_entries(caps_reg if caps_reg is not None else {}, "capabilities"):
        path = entry.get("provider_path")
        if path:
            check(f"registered provider path exists: {name}", os.path.exists(os.path.join(ROOT, path)),
                  f"path={path!r}")

    # 7. Basic naming compliance (kebab-case for registered identifiers and directories).
    for name, _ in walk_map_entries(skills_reg if skills_reg is not None else {}, "projects"):
        check(f"naming kebab-case: {name}", bool(KEBAB_RE.match(name)))
    for name, _ in walk_map_entries(skills_reg if skills_reg is not None else {}, "shared"):
        check(f"naming kebab-case: {name}", bool(KEBAB_RE.match(name)))
    for name, _ in walk_map_entries(caps_reg if caps_reg is not None else {}, "capabilities"):
        check(f"naming kebab-case: {name}", bool(KEBAB_RE.match(name)))
    for base in ("skills/projects", "skills/shared"):
        base_path = os.path.join(ROOT, base)
        if os.path.isdir(base_path):
            for entry in os.listdir(base_path):
                if entry.startswith("."):
                    continue
                check(f"naming kebab-case: {base}/{entry}", bool(KEBAB_RE.match(entry)))

    # 8. Required policy files exist.
    for rel in REQUIRED_POLICY_FILES:
        check(f"required policy exists: {rel}", os.path.exists(os.path.join(ROOT, rel)))

    # 9. Lightweight secret scan.
    for rel in ("registry.yaml", "skills/registry.yaml",
                "external-capabilities/registry.yaml", "dependencies/capability-map.yaml"):
        scan_for_secrets(rel)

    return report(0)


def report(exit_code: int) -> int:
    failures = [(name, detail) for name, ok, detail in checks if not ok]
    for name, ok, _ in checks:
        print(f"[{'PASS' if ok else 'FAIL'}] {name}")
    print(f"\n{len(checks)} checks, {len(failures)} failures")
    if failures:
        print("\nFailures:")
        for name, detail in failures:
            print(f"  - {name}: {detail}")
    return 1 if failures else exit_code


if __name__ == "__main__":
    sys.exit(main())

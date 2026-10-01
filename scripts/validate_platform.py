#!/usr/bin/env python3
"""
Platform Validator — deterministic structural checks
for the AI Capability Platform.

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
    1.  top-level registry parses (YAML, schema_version == 1, platform identity)
    2.  router values: every route is present, is a non-empty string, and points to
        an existing file; domain registries are LOADED THROUGH the routed paths,
        so the top-level router is the true source of truth
    3.  domain registry headers (schema_version / domain / dependencies contract)
    4.  skill registry required fields (name/path/status/version/updated,
        + project for projects entries), map key == name, version X.Y.Z,
        updated YYYY-MM-DD, status legal
    5.  skill path validation: relative path, no ../ escape, directory,
        under the correct domain prefix, leaf == skill name,
        package contains SKILL.md and agents/openai.yaml
    6.  registry <-> filesystem symmetry: a skill package directory on disk
        without a registry entry FAILS (and vice versa)
    7.  duplicate skill identity across projects/shared FAILS
    8.  capability record required fields (name/provider/type/status/provider_path),
        type/status enums, map key == name, provider kebab-case,
        provider_path location and existence
    9.  provider identifiers and provider directory names are lowercase kebab-case
    10. dependency registry is parsed and its top-level contract validated
    11. dependency foreign keys: skill must exist in skills registry,
        capability must exist in external capabilities registry,
        required must be a boolean
    12. secret scan: only credential-bearing fields are flagged;
        reference-name metadata (e.g. secret_reference: production-github-token)
        is permitted and NOT flagged

NOTE on the secret scan: it is a LIGHTWEIGHT HEURISTIC, not a full repository
secret scanner. It guards registry files only. A stronger secret gate
(e.g. Gitleaks) should be evaluated separately if needed.

Usage:
    python3 scripts/validate_platform.py
Exit code 0 = all checks pass; non-zero = failure.
"""

import datetime
import os
import posixpath
import re
import sys

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.stderr.write("ERROR: PyYAML is required (pip install -r requirements-dev.txt)\n")
    sys.exit(2)


# ---- Duplicate-key-detecting YAML loader ----
# yaml.safe_load silently keeps the LAST occurrence of a duplicate mapping key,
# hiding ambiguous or overwritten source-of-truth declarations. This loader
# raises on any duplicate key so validation fails loudly instead.
class UniqueKeyLoader(yaml.SafeLoader):
    pass


def _construct_mapping(loader, node, deep=False):
    mapping = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        if key in mapping:
            raise yaml.constructor.ConstructorError(
                "while constructing a mapping", node.start_mark,
                f"found duplicate key {key!r}", key_node.start_mark)
        mapping[key] = loader.construct_object(value_node, deep=deep)
    return mapping


UniqueKeyLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _construct_mapping)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PRODUCT_NAME = "ai-capability-platform"
PLATFORM_OWNER = "LyraWang6688"

ALLOWED_SKILL_STATUSES = {"draft", "testing", "active", "deprecated", "archived"}
ALLOWED_CAPABILITY_TYPES = {"plugin", "mcp", "connector", "cli", "external-api", "integration"}
ALLOWED_CAPABILITY_STATUSES = {"available", "limited", "disabled", "unknown"}

KEBAB_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

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
    "templates/skill-eval-case.yaml",
    "templates/skill-acceptance-report.md",
    "requirements-dev.txt",
    ".github/workflows/validate-platform.yml",
    "scripts/validate_platform.py",
]

# Credential-bearing key names (the VALUE would be the secret material).
# Includes the bare `token` key: a standalone token field is credential-bearing.
SECRET_KEY_RE = re.compile(
    r"(?i)(api[_-]?key|access[_-]?token|client[_-]?secret|secret|password|credential|cookie|auth[_-]?token|refresh[_-]?token|token)"
)
# Heuristic: an actual-looking secret value (>= 12 chars, not a placeholder).
SECRET_VALUE_RE = re.compile(r"^[A-Za-z0-9_\-./+]{12,}$")
PLACEHOLDER_VALUES = {"null", "none", "true", "false", "example", "xxx", "placeholder", "n/a", "na", "empty"}

checks: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    checks.append((name, ok, detail))


def load_yaml(rel_path: str):
    """Load YAML. FAILS on missing, unparseable, or EMPTY documents.
    Returns (data, ok); data is None when not ok."""
    path = os.path.join(ROOT, rel_path)
    if not os.path.exists(path):
        check(f"exists: {rel_path}", False, "file not found")
        return None, False
    try:
        with open(path, encoding="utf-8") as fh:
            data = yaml.load(fh, Loader=UniqueKeyLoader)
    except Exception as exc:  # noqa: BLE001 (includes duplicate-key ConstructorError)
        check(f"parse: {rel_path}", False, str(exc))
        return None, False
    if data is None:
        check(f"non-empty registry: {rel_path}", False,
              "document is empty (yaml.safe_load returned None)")
        return None, False
    return data, True


def scan_for_secrets(rel_path: str) -> None:
    """Lightweight heuristic secret scan on registry/data files.

    Reference-name metadata fields (e.g. secret_reference: production-github-token)
    are permitted authentication metadata and are NOT flagged. Only
    credential-bearing key: value pairs with real-looking values are flagged.
    This is a heuristic, NOT a full repository secret scanner."""
    if not rel_path.endswith((".yaml", ".yml", ".json")):
        return
    path = os.path.join(ROOT, rel_path)
    if not os.path.exists(path):
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
        k = key.lower()
        # Permitted authentication metadata: reference-name fields, never flagged.
        if k.endswith("_reference") or k.endswith("_ref") or k in ("reference", "ref"):
            continue
        if SECRET_KEY_RE.search(k) and SECRET_VALUE_RE.match(value):
            if value.lower() not in PLACEHOLDER_VALUES:
                hits.append(f"{rel_path}:{lineno} ({key})")
    check(f"secret scan: {rel_path}", not hits, "; ".join(hits) if hits else "clean")


def validate_skill_entries(reg: dict, section: str):
    """Validate the required-field schema of every skill record in a section.
    Returns list of (key, entry)."""
    entries_section = reg.get(section)
    if entries_section is None:
        check(f"skill registry has {section} section", False, "missing section")
        return []
    if not isinstance(entries_section, dict):
        check(f"skill registry {section} is a mapping", False, type(entries_section).__name__)
        return []
    collected = []
    for key, entry in entries_section.items():
        if not isinstance(entry, dict):
            check(f"skill record is a mapping: {section}.{key}", False, type(entry).__name__)
            continue
        collected.append((key, entry))
        required_fields = ["name", "path", "status", "version", "updated"]
        if section == "projects":
            required_fields.append("project")
        for field in required_fields:
            val = entry.get(field)
            present = val is not None
            check(f"skill {section}.{key} has required field: {field}", present,
                  f"value={val!r}")
            if present:
                # Required field = presence + type + semantic format.
                # `updated` is a date-typed field: bare YAML dates (2026-10-01)
                # parse as datetime.date; quoted strings are equally valid.
                if field == "updated":
                    ok_type = isinstance(val, str) or isinstance(val, datetime.date)
                else:
                    ok_type = isinstance(val, str)
                check(f"skill {section}.{key} required field is non-empty string: {field}",
                      ok_type and (isinstance(val, datetime.date) or len(val) > 0),
                      f"value={val!r} type={type(val).__name__}")
        check(f"skill {section}.{key} map key == name", key == entry.get("name"),
              f"key={key!r} name={entry.get('name')!r}")
        check(f"skill {section}.{key} identifier kebab-case", bool(KEBAB_RE.match(key)),
              f"key={key!r}")
        name = entry.get("name")
        if isinstance(name, str) and name:
            check(f"skill {section}.{key} name kebab-case", bool(KEBAB_RE.match(name)), name)
        project = entry.get("project")
        if isinstance(project, str) and project:
            check(f"skill {section}.{key} project kebab-case", bool(KEBAB_RE.match(project)),
                  project)
        status = entry.get("status")
        if status is not None:
            check(f"skill {section}.{key} status legal", status in ALLOWED_SKILL_STATUSES,
                  f"status={status!r}")
        version = entry.get("version")
        if isinstance(version, str):
            check(f"skill {section}.{key} version X.Y.Z", bool(VERSION_RE.match(version)), version)
        updated = entry.get("updated")
        if isinstance(updated, str):
            shape_ok = bool(DATE_RE.match(updated))
            check(f"skill {section}.{key} updated YYYY-MM-DD", shape_ok, updated)
            if shape_ok:
                try:
                    datetime.date.fromisoformat(updated)
                    real_ok = True
                except ValueError:
                    real_ok = False
                check(f"skill {section}.{key} updated is a real calendar date", real_ok,
                      updated)
        elif isinstance(updated, datetime.date):
            check(f"skill {section}.{key} updated YYYY-MM-DD",
                  bool(DATE_RE.match(updated.isoformat())), updated.isoformat())
    return collected


def validate_skill_path(key: str, entry: dict, section: str) -> None:
    """Path must be a relative, contained directory with required package files."""
    path = entry.get("path")
    if not isinstance(path, str) or not path:
        return
    check(f"skill {section}.{key} path is relative", not os.path.isabs(path), path)
    parts = path.split("/")
    check(f"skill {section}.{key} path has no '..'", ".." not in parts, path)
    abs_path = os.path.join(ROOT, path)
    check(f"skill {section}.{key} path is a directory", os.path.isdir(abs_path), path)
    leaf = path.rstrip("/").split("/")[-1]
    check(f"skill {section}.{key} path leaf == skill name", leaf == key, f"leaf={leaf!r} key={key!r}")
    if section == "shared":
        # Exact layout: skills/shared/<skill-name>/ (3 components), no nesting.
        check(f"skill {section}.{key} path under skills/shared/",
              path.startswith("skills/shared/"), path)
        check(f"skill {section}.{key} path has exactly 3 components", len(parts) == 3, path)
    else:
        project = entry.get("project")
        prefix = f"skills/projects/{project}/" if isinstance(project, str) else None
        check(f"skill {section}.{key} path under skills/projects/<project>/",
              bool(prefix) and path.startswith(prefix), f"path={path!r} project={project!r}")
        # Exact layout: skills/projects/<project>/<skill-name>/ (4 components).
        check(f"skill {section}.{key} path has exactly 4 components", len(parts) == 4, path)
    if os.path.isdir(abs_path):
        check(f"skill {section}.{key} package has SKILL.md",
              os.path.isfile(os.path.join(abs_path, "SKILL.md")), path)
        check(f"skill {section}.{key} package has agents/openai.yaml",
              os.path.isfile(os.path.join(abs_path, "agents", "openai.yaml")), path)


def validate_capability_entries(reg: dict):
    """Validate capability record schema. Returns list of (key, entry)."""
    caps = reg.get("capabilities")
    if caps is None:
        check("capability registry has capabilities section", False, "missing section")
        return []
    if not isinstance(caps, dict):
        check("capability registry capabilities is a mapping", False, type(caps).__name__)
        return []
    collected = []
    for key, entry in caps.items():
        if not isinstance(entry, dict):
            check(f"capability record is a mapping: {key}", False, type(entry).__name__)
            continue
        collected.append((key, entry))
        for field in ("name", "provider", "type", "status", "provider_path"):
            val = entry.get(field)
            present = val is not None
            check(f"capability {key} has required field: {field}", present,
                  f"value={val!r}")
            if present:
                # Required field = presence + type + semantic format.
                check(f"capability {key} required field is non-empty string: {field}",
                      isinstance(val, str) and len(val) > 0,
                      f"value={val!r} type={type(val).__name__}")
        check(f"capability {key} map key == name", key == entry.get("name"),
              f"key={key!r} name={entry.get('name')!r}")
        check(f"capability {key} identifier kebab-case", bool(KEBAB_RE.match(key)),
              f"key={key!r}")
        ctype = entry.get("type")
        if ctype is not None:
            check(f"capability {key} type legal", ctype in ALLOWED_CAPABILITY_TYPES, f"type={ctype!r}")
        status = entry.get("status")
        if status is not None:
            check(f"capability {key} status legal", status in ALLOWED_CAPABILITY_STATUSES,
                  f"status={status!r}")
        provider = entry.get("provider")
        if isinstance(provider, str) and provider:
            check(f"capability {key} provider kebab-case", bool(KEBAB_RE.match(provider)), provider)
        pp = entry.get("provider_path")
        if isinstance(pp, str) and pp:
            parts = pp.split("/")
            check(f"capability {key} provider_path relative",
                  not os.path.isabs(pp) and ".." not in parts, pp)
            expected = f"external-capabilities/providers/{provider}/README.md" if isinstance(provider, str) else None
            if expected:
                check(f"capability {key} provider_path location", pp == expected,
                      f"{pp!r} (expected {expected!r})")
            check(f"capability {key} provider_path exists",
                  os.path.isfile(os.path.join(ROOT, pp)), pp)
    return collected


def discover_skill_packages():
    """Find skill packages on disk that contain SKILL.md."""
    found = []
    shared_base = os.path.join(ROOT, "skills/shared")
    if os.path.isdir(shared_base):
        for name in sorted(os.listdir(shared_base)):
            if name.startswith("."):
                continue
            if os.path.isfile(os.path.join(shared_base, name, "SKILL.md")):
                found.append(f"skills/shared/{name}")
    proj_base = os.path.join(ROOT, "skills/projects")
    if os.path.isdir(proj_base):
        for proj in sorted(os.listdir(proj_base)):
            if proj.startswith("."):
                continue
            proj_dir = os.path.join(proj_base, proj)
            if not os.path.isdir(proj_dir):
                continue
            for name in sorted(os.listdir(proj_dir)):
                if name.startswith("."):
                    continue
                if os.path.isfile(os.path.join(proj_dir, name, "SKILL.md")):
                    found.append(f"skills/projects/{proj}/{name}")
    return found


def main() -> int:
    # ---- 1. Top-level registry ----
    top, ok = load_yaml("registry.yaml")
    if not ok:
        return report(1)
    check("top-level registry schema_version", top.get("schema_version") == 1,
          f"got {top.get('schema_version')!r}")
    check("top-level platform name", top.get("platform", {}).get("name") == PRODUCT_NAME,
          repr(top.get("platform", {}).get("name")))
    check("top-level platform owner", top.get("platform", {}).get("owner") == PLATFORM_OWNER,
          repr(top.get("platform", {}).get("owner")))

    # ---- 2. Router values: present, non-empty string, exists; load through router ----
    refs = top.get("registries")
    expected_domains = ("skills", "external_capabilities", "dependencies")
    if not isinstance(refs, dict):
        check("top-level registries is a mapping", False, type(refs).__name__)
        return report(1)
    check("top-level registry routes all domains", set(refs.keys()) == set(expected_domains),
          f"routes: {sorted(refs.keys())}")
    for domain in expected_domains:
        val = refs.get(domain)
        check(f"route value present: {domain}", val is not None, "missing route value")
        check(f"route value is non-empty string: {domain}",
              isinstance(val, str) and len(val) > 0, repr(val))
        if isinstance(val, str) and val:
            parts = val.split("/")
            check(f"route value has no '..': {domain}", ".." not in parts, val)
    # Uniqueness is checked on NORMALIZED paths: external-capabilities/registry.yaml
    # and external-capabilities/../external-capabilities/registry.yaml resolve to
    # the same file and must be treated as a duplicate.
    norm_paths = [posixpath.normpath(refs[d])
                  for d in expected_domains if isinstance(refs.get(d), str) and refs[d]]
    check("registry paths not duplicated (normalized)",
          len(norm_paths) == len(set(norm_paths)),
          "duplicate registry path in top-level registries")
    for domain in expected_domains:
        rel = refs.get(domain)
        if isinstance(rel, str) and rel:
            check(f"referenced registry exists: {rel}", os.path.exists(os.path.join(ROOT, rel)),
                  "file not found")

    def _routed(domain):
        """Normalized routed path for a domain, or None when unusable."""
        rel = refs.get(domain)
        return posixpath.normpath(rel) if isinstance(rel, str) and rel else None

    # Load domain registries THROUGH the router values (router = source of truth).
    skills_rel = _routed("skills")
    skills_reg, skills_ok = load_yaml(skills_rel) if skills_rel else (None, False)
    caps_rel = _routed("external_capabilities")
    caps_reg, caps_ok = load_yaml(caps_rel) if caps_rel else (None, False)
    deps_rel = _routed("dependencies")
    deps_reg, deps_ok = load_yaml(deps_rel) if deps_rel else (None, False)

    # ---- 3. Domain registry headers ----
    if skills_ok:
        check("skills registry schema_version", skills_reg.get("schema_version") == 1,
              f"got {skills_reg.get('schema_version')!r}")
        check("skills registry domain", skills_reg.get("domain") == "skills",
              repr(skills_reg.get("domain")))
    if caps_ok:
        check("capability registry schema_version", caps_reg.get("schema_version") == 1,
              f"got {caps_reg.get('schema_version')!r}")
        check("capability registry domain", caps_reg.get("domain") == "external_capabilities",
              repr(caps_reg.get("domain")))
    if deps_ok:
        check("dependency registry schema_version", deps_reg.get("schema_version") == 1,
              f"got {deps_reg.get('schema_version')!r}")
        check("dependency registry dependencies is a list",
              isinstance(deps_reg.get("dependencies"), list),
              type(deps_reg.get("dependencies")).__name__)

    # ---- 4/5. Skill registry schema + paths ----
    shared_entries = validate_skill_entries(skills_reg, "shared") if skills_ok else []
    proj_entries = validate_skill_entries(skills_reg, "projects") if skills_ok else []
    if skills_ok:
        allowed = set(skills_reg.get("allowed_statuses") or [])
        check("skills registry keeps 5 lifecycle statuses", allowed == ALLOWED_SKILL_STATUSES,
              f"allowed={sorted(allowed)}")
    for key, entry in shared_entries:
        validate_skill_path(key, entry, "shared")
    for key, entry in proj_entries:
        validate_skill_path(key, entry, "projects")

    # ---- 6. Registry <-> filesystem symmetry ----
    registered_paths = set()
    for key, entry in shared_entries + proj_entries:
        path = entry.get("path")
        if isinstance(path, str) and path:
            registered_paths.add(path.rstrip("/"))
    for rel in discover_skill_packages():
        check(f"filesystem skill is registered: {rel}", rel in registered_paths,
              "package directory exists but has no registry entry")

    # ---- 6b. Filesystem skill / project directory naming (kebab-case) ----
    shared_base = os.path.join(ROOT, "skills/shared")
    if os.path.isdir(shared_base):
        for name in sorted(os.listdir(shared_base)):
            if name.startswith("."):
                continue
            if not os.path.isdir(os.path.join(shared_base, name)):
                continue  # metadata files (e.g. README.md) are not skill packages
            check(f"filesystem skill directory kebab-case: skills/shared/{name}",
                  bool(KEBAB_RE.match(name)), name)
    proj_base = os.path.join(ROOT, "skills/projects")
    if os.path.isdir(proj_base):
        for proj in sorted(os.listdir(proj_base)):
            if proj.startswith("."):
                continue
            if not os.path.isdir(os.path.join(proj_base, proj)):
                continue
            check(f"filesystem project directory kebab-case: skills/projects/{proj}",
                  bool(KEBAB_RE.match(proj)), proj)
            proj_dir = os.path.join(proj_base, proj)
            for name in sorted(os.listdir(proj_dir)):
                if name.startswith("."):
                    continue
                if not os.path.isdir(os.path.join(proj_dir, name)):
                    continue  # project README.md / metadata files are not skills
                check(f"filesystem skill directory kebab-case: skills/projects/{proj}/{name}",
                      bool(KEBAB_RE.match(name)), name)

    # ---- 7. Duplicate skill identity ----
    shared_names = {key for key, _ in shared_entries}
    proj_names = {key for key, _ in proj_entries}
    duplicates = shared_names & proj_names
    check("no duplicate skill identity across projects/shared", not duplicates,
          f"duplicates: {sorted(duplicates)}")

    # ---- 8/9. Capability schema + provider naming ----
    cap_entries = validate_capability_entries(caps_reg) if caps_ok else []
    if caps_ok:
        allowed_types = set(caps_reg.get("allowed_types") or [])
        allowed_statuses = set(caps_reg.get("allowed_statuses") or [])
        check("capability registry supports 6 types", allowed_types == ALLOWED_CAPABILITY_TYPES,
              f"types={sorted(allowed_types)}")
        check("capability registry keeps 4 statuses", allowed_statuses == ALLOWED_CAPABILITY_STATUSES,
              f"statuses={sorted(allowed_statuses)}")
    providers_dir = os.path.join(ROOT, "external-capabilities/providers")
    if os.path.isdir(providers_dir):
        for name in sorted(os.listdir(providers_dir)):
            if name.startswith("."):
                continue
            check(f"provider directory kebab-case: {name}", bool(KEBAB_RE.match(name)), name)

    # ---- 10/11. Dependency registry parsing + foreign keys ----
    skill_ids = shared_names | proj_names
    capability_ids = {key for key, _ in cap_entries}
    if deps_ok:
        deps = deps_reg.get("dependencies")
        if isinstance(deps, list):
            seen_skills = set()
            for i, dep in enumerate(deps):
                if not isinstance(dep, dict):
                    check(f"dependency {i} is a mapping", False, type(dep).__name__)
                    continue
                # Enforce the dependency entry schema: only skill + requires are
                # allowed. Fields such as skill_version or type would recreate a
                # second source of truth and are rejected.
                unknown_dep = set(dep.keys()) - {"skill", "requires"}
                check(f"dependency {i} has only allowed fields", not unknown_dep,
                      f"unknown fields: {sorted(unknown_dep)}")
                skill = dep.get("skill")
                check(f"dependency {i} has skill", isinstance(skill, str) and skill,
                      f"skill={skill!r}")
                if isinstance(skill, str) and skill:
                    check(f"dependency {i} skill exists in skills registry",
                          skill in skill_ids, f"skill={skill!r}")
                    # Uniqueness: one dependency entry per skill.
                    check(f"dependency {i} skill unique in list", skill not in seen_skills,
                          f"duplicate dependency for skill={skill!r}")
                    seen_skills.add(skill)
                requires = dep.get("requires")
                check(f"dependency {i} requires is a list", isinstance(requires, list),
                      type(requires).__name__)
                if isinstance(requires, list):
                    seen_caps = set()
                    for j, req in enumerate(requires):
                        if not isinstance(req, dict):
                            check(f"dependency {i}.requires[{j}] is a mapping", False,
                                  type(req).__name__)
                            continue
                        unknown_req = set(req.keys()) - {"capability", "required", "notes"}
                        check(f"dependency {i}.requires[{j}] has only allowed fields",
                              not unknown_req, f"unknown fields: {sorted(unknown_req)}")
                        cap = req.get("capability")
                        check(f"dependency {i}.requires[{j}] has capability",
                              isinstance(cap, str) and cap, f"capability={cap!r}")
                        if isinstance(cap, str) and cap:
                            check(f"dependency {i}.requires[{j}] capability exists in capability registry",
                                  cap in capability_ids, f"capability={cap!r}")
                            # Uniqueness: one requirement entry per capability within a skill.
                            check(f"dependency {i}.requires[{j}] capability unique in skill",
                                  cap not in seen_caps,
                                  f"duplicate requirement for capability={cap!r}")
                            seen_caps.add(cap)
                        required = req.get("required")
                        check(f"dependency {i}.requires[{j}] required is a boolean",
                              isinstance(required, bool), repr(required))

    # ---- Required policy / asset files ----
    for rel in REQUIRED_POLICY_FILES:
        check(f"required asset exists: {rel}", os.path.exists(os.path.join(ROOT, rel)))

    # ---- 12. Lightweight secret scan, following the router (reference metadata exempt) ----
    # The top-level registry.yaml plus every routed domain registry are scanned,
    # so structured validation and security validation read the same sources.
    scan_targets = ["registry.yaml"]
    for domain in expected_domains:
        rel = _routed(domain)
        if rel:
            scan_targets.append(rel)
    for rel in scan_targets:
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

# Asset Publishing Protocol

This file answers: when Wang Ying explicitly says "this asset goes into the Store",
what must an Agent do?

**Whether an asset is published is a Human decision.**
An Agent must NOT decide on its own that "this thing is valuable, so I will publish it."

## High-Level Flow (all asset types)

```text
Human Approval to Publish
        ↓
Read Store Rules (AGENTS.md → CONTRIBUTING_AI.md → PUBLISHING.md → VERSIONING.md
                  → registry.yaml → Domain README → Domain Policy)
        ↓
Reuse Scan (check skills/registry.yaml, external-capabilities/registry.yaml,
           dependencies/capability-map.yaml for existing entities)
        ↓
Identify Asset Type (Skill | External Capability)
        ↓
Choose Canonical Placement (see Placement rules below)
        ↓
Preserve Native Asset Structure (Skill protocol / MCP protocol are NOT rewritten)
        ↓
Normalize Store Metadata (registry entry per Domain Contract)
        ↓
Register in Domain Registry
        ↓
Declare Dependencies when applicable (dependencies/capability-map.yaml)
        ↓
Bring / Link Valid Tests and Evidence
        ↓
Secret Scan (no credential values — Authentication Metadata only)
        ↓
Store Validator (scripts/validate_store.py)
        ↓
Feature Branch → PR → CI → Review
        ↓
Human Approval
        ↓
Merge
        ↓
Tag / Release when applicable (namespaced Git Tag; Release for distributable artifacts)
```

## A. Skill Asset Publishing

1. Confirm Human approval to publish the Skill.
2. Reuse Scan against `skills/registry.yaml`.
3. Placement: always `skills/<skill-name>/` (flat — see `skills/README.md` for why).
   Cross-project vs project-specific is recorded in the registry, not the path:
   - Cross-project reusable: `scope: shared` (default)
   - Project-specific: `scope: project` + `project: <project-name>`
4. Preserve the Skill's native structure (`SKILL.md`, `agents/openai.yaml`, etc. — see `skills/README.md`).
5. Register in `skills/registry.yaml` (name / path / status / version / updated, + scope / project for project skills).
6. If the Skill depends on External Capabilities, declare them in `dependencies/capability-map.yaml`.
7. Bring or link tests/evidence (Gate 0-6 in `skills/ACCEPTANCE.md` apply to promotion, not just publication).

## B. External Capability Asset Publishing

1. Confirm Human approval to publish the External Capability.
2. Reuse Scan against `external-capabilities/registry.yaml`.
3. Placement:
   - Store-managed implementation: `external-capabilities/mcp/<capability-name>/` (for MCP; other shelves are created only when a real asset needs them)
   - Provider documentation: `external-capabilities/providers/<provider-name>/README.md`
4. Preserve the native protocol structure (e.g. a Node/Python/Go MCP keeps its own project layout — the Store only fixes where the asset root lives, not the internal source layout).
5. Register in `external-capabilities/registry.yaml`:
   - Required: name / provider / type / status / provider_path
   - Store-managed (has `implementation_path`): also requires `version` (semantic X.Y.Z)
   - Optional: auth metadata / capabilities / permissions / notes
6. Never register credential values — Authentication Metadata ≠ Credential Storage (`external-capabilities/SECURITY.md`).
7. Bring or link tests and evidence for the capability.

## Stop Conditions

- Missing required metadata → do not guess; ask Human.
- A credential value is found → stop, remove, and rotate; do not merely delete the file.
- Asset type is ambiguous → ask Human; do not mix a Workflow/SOP into the Capability Registry (DOMAIN_MISMATCH) or an External Capability into the Skill Registry.

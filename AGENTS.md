# AGENTS.md — Platform Control Plane / Router

Any Agent (human or AI) modifying this repository MUST read, in order, before making changes:

1. `AGENTS.md` (this file — routing only)
2. `CONTRIBUTING_AI.md` (public contribution rules)
3. `registry.yaml` (top-level platform router)
4. The README of the Domain being touched:
   - `skills/README.md` for Skill Domain work
   - `external-capabilities/README.md` for External Capability Domain work
   - `dependencies/capability-map.yaml` for dependency work
5. The Domain Policy files of the touched area
   (e.g. `skills/LIFECYCLE.md`, `skills/VERSIONING.md`, `skills/ACCEPTANCE.md`, `external-capabilities/SECURITY.md`)
6. The current target entity (skill / capability / dependency record) before editing it

AGENTS.md is the Control Plane / Router. It does NOT duplicate policy.
Domain-specific policy lives in the Domain directories.

## Domain Routing

| Intent | Route |
|---|---|
| Add / change a Skill (how-to procedure / workflow) | `skills/` |
| Add / change an External Capability (plugin / MCP / connector / CLI / API / integration) | `external-capabilities/` |
| Record a Skill ↔ External Capability dependency | `dependencies/capability-map.yaml` |
| Change platform-wide policy | top-level policy files |

Skills and External Capabilities are **peer Domains**. A Plugin is NOT a sub-entity of a Skill.

## Source of Truth

| State | Owner |
|---|---|
| Skill identity / path / lifecycle / version | `skills/registry.yaml` |
| External capability identity / provider / type / availability / auth / permissions | `external-capabilities/registry.yaml` |
| Skill ↔ External Capability dependencies | `dependencies/capability-map.yaml` |
| Platform registry routing | `registry.yaml` (top level, router only) |

A single core fact is maintained in exactly one registry. Do not duplicate Domain state into the top level.

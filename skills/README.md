# Skill Domain — Skills

**Domain: Skills = How to do**

A Skill is a reusable procedure / workflow / capability logic owned by the platform.
It defines HOW the Agent should execute a task.

## Core Model

| Layer | Meaning |
|---|---|
| Agent | Who executes |
| Skill | How to execute |
| External Capability | What to execute with |

Skills and External Capabilities are **peer Domains**. A Plugin / MCP / Connector is NOT a sub-entity of a Skill.

## Placement

- Project-specific skill: `skills/projects/<project-name>/<skill-name>/`
- Cross-project reusable skill: `skills/shared/<skill-name>/`

Do not duplicate the same skill across multiple projects. Move genuinely reusable skills to `shared/`.

## Skill Structure

Each skill must contain at least:

```text
<skill-name>/
├── SKILL.md
└── agents/
    └── openai.yaml
```

Add these only when needed:

- `scripts/` for deterministic executable logic
- `references/` for documentation or knowledge loaded on demand
- `assets/` for templates, icons, images, or other output resources

Keep `SKILL.md` focused. Do not use it as a project knowledge dump.

## Registry

`skills/registry.yaml` is the machine-readable source of truth for:

- Skill identity
- path
- lifecycle status
- version

Required fields per skill entry (when registered):

- `name`
- `path`
- `status`
- `version`
- `updated`

Project-specific skills should also be associated with a project.

## Lifecycle

`draft -> testing -> active -> deprecated -> archived`

See [LIFECYCLE.md](./LIFECYCLE.md) for transition rules.

## Versioning

Semantic `X.Y.Z` per skill. See [VERSIONING.md](./VERSIONING.md).

## Acceptance

Every skill must pass the gates in [ACCEPTANCE.md](./ACCEPTANCE.md) before promotion.

## Add or Update Workflow

1. Determine whether the requested capability already exists (Reuse Scan).
2. Determine whether it is project-specific or shared.
3. Read the existing skill before changing it.
4. Make the smallest coherent change.
5. Update `skills/registry.yaml`.
6. Update the project `README.md` when project membership changes.
7. Preserve Git history; do not silently overwrite unrelated work.
8. Use a clear commit message (see `CONTRIBUTING_AI.md`).

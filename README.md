# AI Capability Platform

This repository manages long-term reusable **AI Capabilities**.

## Core Model

```text
Agent               = Who executes
Skill               = How to execute
External Capability = What to execute with
```

## Platform Question

> What can my AI do, how should it do it, and what external capabilities can it use?

## Two Peer Bounded Contexts

| Domain | Owns | Examples |
|---|---|---|
| Skills | How to do | Procedure / Workflow / Capability Logic |
| External Capabilities | What can be called | Plugin / MCP / Connector / CLI / API / Integration |

Skills and External Capabilities are **peer Domains**. A Plugin is NOT a sub-entity of a Skill.

## Dependency Layer

```text
Skill → Required External Capabilities
```

`dependencies/capability-map.yaml` records which External Capabilities a Skill requires.

## Repository Structure

```text
ai-capability-platform/
├── AGENTS.md                       # Control Plane / Router for Agents
├── README.md
├── CONTRIBUTING_AI.md              # Public contribution rules
├── registry.yaml                   # Top-level Platform Router
├── skills/                         # Domain A: Skills (how to do)
│   ├── README.md
│   ├── registry.yaml
│   ├── LIFECYCLE.md
│   ├── VERSIONING.md
│   ├── ACCEPTANCE.md
│   ├── shared/
│   └── projects/
├── external-capabilities/          # Domain B: External Capabilities (what can be called)
│   ├── README.md
│   ├── registry.yaml
│   ├── SECURITY.md
│   ├── providers/
│   └── use-cases/
├── dependencies/
│   └── capability-map.yaml
├── tests/                          # Development / Evaluation Layer
├── templates/                      # skill-eval-case.yaml / skill-acceptance-report.md
├── requirements-dev.txt            # Dev dependencies (PyYAML)
├── .github/workflows/
│   └── validate-platform.yml       # Deterministic CI gate
└── scripts/
    └── validate_platform.py        # Deterministic structural validator
```

## Source of Truth

| State | Owner |
|---|---|
| Skill identity / path / lifecycle / version | `skills/registry.yaml` |
| External capability identity / provider / type / availability / auth / permissions | `external-capabilities/registry.yaml` |
| Skill ↔ External Capability dependencies | `dependencies/capability-map.yaml` |
| Platform registry routing | `registry.yaml` (top level, router only) |

## Navigation

- **Contribute**: read `AGENTS.md` and `CONTRIBUTING_AI.md` first.
- **Validate**: install dev dependencies and run the deterministic validator:
  ```bash
  pip install -r requirements-dev.txt
  python3 scripts/validate_platform.py
  ```
  The same gate runs automatically via `.github/workflows/validate-platform.yml` on every PR and push to `main`.
- **Skill rules**: `skills/` (LIFECYCLE, VERSIONING, ACCEPTANCE).
- **External capability rules**: `external-capabilities/` (SECURITY).
- **Dependencies**: `dependencies/capability-map.yaml`.

# External Capability Domain — External Capabilities

**Domain: External Capabilities = What can be called**

An External Capability is an external tool or service the Agent may use to execute part of a workflow.

Includes:

- Plugin
- MCP server
- Connector
- CLI
- external API used as a tool
- authenticated application integration

## Peer Domains

```text
Skill                = How to do
External Capability  = What can be called
```

Skills and External Capabilities are **peer Domains**. A Plugin is NOT a sub-entity of a Skill.

## Placement

```text
external-capabilities/providers/<provider-name>/README.md
external-capabilities/use-cases/<use-case>.md
external-capabilities/mcp/<capability-name>/     # Store-managed MCP implementations
```

Use lowercase kebab-case for provider identifiers.

Store-managed implementation shelf: the Store hosts and maintains code for some
capabilities (e.g. its own MCP servers). Store-managed implementations live
under `external-capabilities/mcp/<capability-name>/`. Shelves for other types
(cli/ / connector/ / api/ / plugin/) are created only when a real asset needs
them. The Store fixes the asset ROOT location only; it does NOT prescribe the
internal source layout of an MCP (Node / Python / Go projects keep their own
native structure).

## Registry

`external-capabilities/registry.yaml` is the machine-readable source of truth for:

- capability identity
- provider
- type
- availability status
- auth model
- permission model
- capabilities
- version (Store-recommended version)
- implementation (Store-managed code location)

A capability record requires:

- `name`          — capability identifier (lowercase kebab-case, == map key)
- `provider`      — provider identifier (lowercase kebab-case)
- `type`          — one of: plugin / mcp / connector / cli / external-api / integration
- `status`        — one of: available / limited / disabled / unknown
- `provider_path` — `external-capabilities/providers/<provider>/README.md` (must exist)

Optional, when known:

- `version`              — semantic X.Y.Z (Store-recommended version; see `VERSIONING.md`)
- `implementation_path`  — relative repo path to Store-managed code; when present it
                           must exist, live under `external-capabilities/`, and the
                           entry must declare a valid `version` (Store-managed capability).
                           Pure external capabilities omit it.
- `auth`          — authentication model (metadata only)
- `capabilities`  — what the capability can do
- `permissions`   — verified permissions only
- `notes`         — free-form notes

Do not invent unknown permissions or authentication methods.

## Security

Authentication metadata ≠ credential storage. See [SECURITY.md](./SECURITY.md).

## Status Values

- `available`
- `limited`
- `disabled`
- `unknown`

## Add or Update Workflow

1. Check whether the plugin / provider already exists (Reuse Scan).
2. Inspect the current record.
3. Add or update only verified information.
4. Update `external-capabilities/registry.yaml`.
5. Update the provider README when details change.
6. Use a clear commit message (see `CONTRIBUTING_AI.md`).

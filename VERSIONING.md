# Store-Level Versioning — X.Y.Z (single Source of Truth)

This file is the **Store-wide** versioning contract for all assets (Skills and
External Capabilities). Skill-specific versioning semantics supplement this
file and live in `skills/VERSIONING.md`; no duplicate SemVer rules are kept.

## 1. Stable Machine Identifier

Every asset has a stable machine identifier:

```text
repo-hygiene
feishu-cli-mcp-server
```

Do NOT express version through directory names. Forbidden:

```text
repo-hygiene-v1/
repo-hygiene-v2/
repo-hygiene-final/
```

## 2. Canonical Path Is Stable

```text
skills/repo-hygiene/
external-capabilities/mcp/feishu-cli-mcp-server/
```

Upgrading the version does NOT change the directory.

## 3. Semantic Versioning

```text
MAJOR.MINOR.PATCH
```

| Segment | Increment when |
|---|---|
| PATCH | backward-compatible fix |
| MINOR | backward-compatible capability addition |
| MAJOR | breaking change / incompatible behavior |

## 4. Registry `version` = Current Store-Recommended Version

`version` in a Domain registry means: the version the Store currently
recommends for use. It is the default for consumers.

## 5. `main` = Current Maintained State

`main` holds the latest state currently being maintained. Registries on `main`
describe the current recommended versions.

## 6. Immutable Historical Versions = Namespaced Git Tags

Use namespaced Git Tags:

```text
<asset-name>-vX.Y.Z
```

Examples:

```text
repo-hygiene-v0.1.0
feishu-cli-mcp-server-v0.1.0
```

Do NOT use a monorepo-wide tag such as `v0.1.0` — multiple assets would collide.

## 7. GitHub Releases

Releases are for finished artifacts that need to be downloadable/distributable.
Do NOT force a Release for every internal experimental version.

## 8. Consumer Version Policy

- Default: use the version currently recommended in the Registry.
- Consumers / projects that need stable reproduction may pin to a specific
  immutable Git Tag.

## 9. Stable ID

Brand copy / display names may change. Machine identifiers stay stable.
Do NOT create a new machine asset identity because of a logo / copy / display-name
change. Machine-ID migration is deferred until a real need exists.

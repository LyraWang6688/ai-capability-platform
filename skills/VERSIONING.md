# Skill Versioning — X.Y.Z

Every skill uses a semantic-style version `X.Y.Z`.

## Increment Rules

| Segment | Increment when |
|---|---|
| PATCH (`X.Y.Z`) | bug fix / non-breaking correction |
| MINOR (`X.Y.0`) | validated new capability / new workflow / meaningful rule change |
| MAJOR (`X.0.0`) | breaking contract / incompatible behavior |

Version changes should reflect meaningful skill changes, not every documentation edit.

## Version Semantics by Lifecycle

```text
0.x.x  experimental / draft / testing
1.x.x+ active and stable enough for normal use
```

## Git Tags

Use per-skill tags:

```text
<skill-name>-vX.Y.Z
```

Example:

```text
repo-hygiene-v0.1.0
```

Do NOT use a monorepo-wide tag such as `v0.1.0` — multiple skills would collide.

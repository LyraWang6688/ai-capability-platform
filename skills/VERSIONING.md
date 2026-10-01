# Skill Versioning — Supplement

The **Store-wide** versioning contract is `VERSIONING.md` at the repository
root (single Source of Truth). This file is the Skill-Domain supplement; it
does NOT duplicate the SemVer rules.

## Skill-Specific Semantics

```text
0.x.x  experimental / draft / testing
1.x.x+ active and stable enough for normal use
```

A skill whose status is `active` must have a major version >= 1 (enforced by
`scripts/validate_store.py`).

## Git Tags

Per-skill namespaced tags (see root `VERSIONING.md`):

```text
<skill-name>-vX.Y.Z
```

Example:

```text
repo-hygiene-v0.1.0
```

Do NOT use a monorepo-wide tag such as `v0.1.0` — multiple skills would collide.

## References

- Store-wide rules: [`../VERSIONING.md`](../VERSIONING.md)
- Lifecycle mapping: [`LIFECYCLE.md`](./LIFECYCLE.md)

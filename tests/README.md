# tests/ — Development / Evaluation Layer

`tests/` is the **Development / Evaluation Layer** for the Platform.

- `tests/skills/` — evaluation harnesses and fixtures for the Skill Domain
- `tests/external-capabilities/` — evaluation harnesses and fixtures for the External Capability Domain

## Contract

- Tests evaluate behavior; they do NOT define runtime skill packages.
- A skill lives under `skills/`; its tests live under `tests/skills/`.
- No fake PASS results are committed.
- The deterministic structural check is `scripts/validate_platform.py` — a validator, not a quality judge.

```text
tests/
= Development / Evaluation Layer
≠ Runtime Skill Package
```

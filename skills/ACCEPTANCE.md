# Skill Acceptance Framework — v0.1

Skill Acceptance Standard v0.1.

## Gates

| Gate | Name | Requirement |
|---|---|---|
| Gate 0 | Structure Compliance | Skill contains the required structure (SKILL.md, agents/openai.yaml, correct placement, registry entry). |
| Gate 1 | Trigger Quality | Clear, specific trigger conditions; no over-triggering; core scenarios covered. |
| Gate 2 | Task Success | Skill completes its defined task end-to-end on a representative case. |
| Gate 3 | Execution / Trajectory | Execution trajectory is coherent, observable, and reproducible. |
| Gate 4 | Safety | No safety violations in any tested scenario. |
| Gate 5 | Regression | Previously passing behavior still passes. |
| Gate 6 | Efficiency / Economics | Observation metric recorded; no arbitrary threshold in v0.1. |

## Pass Rule

- **Critical Safety / Critical Expectations: 100% PASS required.**
- A safety failure CANNOT be offset by an overall score.
- Non-critical gate failures must be resolved before promotion to `active`.

## Efficiency (v0.1 — Observation Metric only)

Record, do not gate:

- tokens
- latency
- tool calls
- retry count
- API cost

v0.1 does NOT set arbitrary uniform cost thresholds. Thresholds, if any, come later with real data.

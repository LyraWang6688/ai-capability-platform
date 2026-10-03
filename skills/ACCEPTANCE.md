# Skill Acceptance Standard v0.1

Skill Acceptance Standard v0.1 — an executable Acceptance Contract.
A Skill Producer Agent must be able to determine, from this document,
exactly what counts as PASS for each gate.

## Pass Rule (overarching)

- **Critical Safety / Critical Expectations: 100% PASS required.**
- A safety failure CANNOT be offset by an overall score.
- Non-critical gate failures must be resolved before promotion to `active`.

## Evidence Principle

Agent self-reports ("I finished") are **NOT** acceptable PASS evidence.
Legitimate evidence includes:

- diff
- test result
- validator output
- tool trace
- artifact inspection
- deterministic script output
- expected structured field
- Git state

Every PASS must be bound to evidence.

---

## Gate 0 — Structure Compliance

**Must be 100% PASS.**

At least:

- correct placement (flat layout: `skills/<name>/` — one level, no nesting)
- `SKILL.md` present
- `agents/openai.yaml` present
- registry entry present and valid (key == name, required fields complete)
- valid version (`X.Y.Z`)
- valid lifecycle (`draft | testing | active | deprecated | archived`)
- no broken required path
- `python3 scripts/validate_store.py` PASS

## Gate 1 — Trigger Quality

Must define and test:

- Positive Trigger Cases
- Negative Trigger Cases

Store v0.1 initial acceptance thresholds
(this is the AI Capability Store's own initial threshold,
not a vendor-mandated standard):

- Positive trigger rate >= 90%
- False trigger rate <= 10%

Reports must record `numerator / denominator` for both rates — not only percentages.

## Gate 2 — Task Success

Each case defines at least:

- Prompt / Input
- Expected Outcome
- Critical Expectations
- Non-critical Expectations
- Evidence

Rules:

- Critical Expectations: **100% PASS**
- Non-critical Expectations: v0.1 target **>= 90%**

Record `passed / total` for both categories.

## Gate 3 — Execution / Trajectory

Support defining:

- Required Steps
- Forbidden Steps
- Required Tools
- Approval Points

Rules:

- Required Critical Steps: **100% observed**
- Forbidden Critical Steps: **0 occurrences**

A correct final output does NOT excuse a wrong execution path.

## Gate 4 — Safety

- Critical Safety: **100% PASS**
- Any Critical Safety Failure fails the entire Acceptance.
- Cannot be offset by other scores.

## Gate 5 — Regression

- Critical Cases already in the Regression Baseline must re-PASS before a new release.
- Any Critical Regression Failure is a **Release Block**.

## Gate 6 — Efficiency / Economics

V0.1 is **Observation only**. Record applicable metrics:

- input tokens
- output tokens
- total tokens
- latency
- execution duration
- tool calls
- retry count
- external API cost

If a new version is clearly worse than the previous one,
the Acceptance Report MUST explain why.
No uniform hard threshold is set in v0.1.

---

## Lifecycle Mapping

| Lifecycle | Acceptance requirement |
|---|---|
| `draft` | Evaluation may be incomplete; structure may still be changing. |
| `testing` | Gate 0 PASS, Critical Safety PASS, at least one real or representative task evidence; other gates may continue to accumulate. |
| `active` | Gate 0–5 satisfy active promotion requirements, Gate 6 metrics recorded (when applicable), no blocking issue, Human Approval. |
| `deprecated` / `archived` | Keep existing semantics (see `LIFECYCLE.md`). |

This avoids the logical conflict of "all skills must pass every gate" while `testing` is by definition still being tested.

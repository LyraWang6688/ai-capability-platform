# Skill Acceptance Report

| Field | Value |
|---|---|
| Skill | <skill-name> |
| Version | <x.y.z> |
| Lifecycle | <draft / testing / active / deprecated / archived> |
| Evaluation Date | <YYYY-MM-DD> |

## Gate 0 — Structure

- Result: <PASS / FAIL>
- Evidence: <validator output, diff>

## Gate 1 — Trigger

- Positive trigger rate: <passed / total> (target >= 90%)
- False trigger rate: <false / total> (target <= 10%)
- Evidence: <case files>

## Gate 2 — Task Success

- Critical Expectations: <passed / total> (100% required)
- Non-critical Expectations: <passed / total> (v0.1 target >= 90%)
- Evidence: <case files, tool trace>

## Gate 3 — Execution / Trajectory

- Required Critical Steps observed: <n / total>
- Forbidden Critical Steps occurrences: <n> (0 required)
- Evidence: <tool trace>

## Gate 4 — Safety

- Result: <PASS / FAIL> (Critical Safety must be 100% PASS)
- Evidence: <case files>

## Gate 5 — Regression

- Regression Baseline cases re-passed: <n / total>
- Result: <PASS / FAIL (Release Block if critical regression)>
- Evidence: <case files>

## Gate 6 — Efficiency / Economics (v0.1: observation only)

| Metric | Value |
|---|---|
| input tokens | |
| output tokens | |
| total tokens | |
| latency | |
| execution duration | |
| tool calls | |
| retry count | |
| external API cost | |

If clearly worse than the previous version, explain why:

## Cases Tested

- <list of case ids under tests/skills/<skill-name>/cases/>

## Evidence

- <diff / test result / validator output / tool trace / artifact inspection / deterministic script output / expected structured field / Git state>

## Blocking Issues

- <none, or list>

## Final Result

**PASS / FAIL**

## Lifecycle Recommendation

- <draft / testing / active / deprecated / archived> — reason:

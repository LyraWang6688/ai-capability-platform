# Skill Acceptance Report

| Field | Value |
|---|---|
| Skill | repo-hygiene |
| Version | 0.1.0 |
| Lifecycle | testing |
| Evaluation Date | 2026-10-02 |

## Gate 0 — Structure

- Result: PASS
- Evidence: `python3 scripts/validate_store.py` completed with 81 checks and 0 failures; the native Skill validator reported `Skill is valid!`; the Store package contains `SKILL.md` and `agents/openai.yaml`; registry path, version, lifecycle, and date were accepted.
- Boundary: `skills/ACCEPTANCE.md` still names the nonexistent legacy command `scripts/validate_platform.py`, while `PUBLISHING.md`, `tests/README.md`, CI, and the repository contain `scripts/validate_store.py`. This is recorded as `STORE_CONTRACT_GAP` and was not repaired in this onboarding PR.

## Gate 1 — Trigger

- Positive trigger rate: not evaluated (0 / 0)
- False trigger rate: not evaluated (0 / 0)
- Evidence: no formal trigger-selection harness or preserved trigger trace exists for Case #001. The `SKILL.md` description includes positive scope and a worktree/unpushed-work exclusion, but text inspection is not counted as trigger-rate evidence.

## Gate 2 — Task Success

- Critical Expectations: 5 / 5 supported by the real Teaming-Bot Case #001 evidence.
- Non-critical Expectations: 3 / 3 supported by the recorded Case #001 artifacts.
- Evidence:
  - `tests/skills/repo-hygiene/cases/case-001-teaming-bot-real-task.yaml`
  - `skills/shared/repo-hygiene/references/case-001-teaming-bot.md`
  - Teaming-Bot PR #6 is `MERGED` into `main` with squash commit `cf8d1f92ef4a06fc2e40b97c08f898cd5f24efa9`.
  - The PR file list contains only `.gitignore` and documentation/archival assets, including two `R100` document renames and the added diagram; it contains no business source or dependency manifest.
  - Current local readback confirms Teaming-Bot `main` at that squash commit, a clean worktree, and `.local/reports/meeting-category-backfill-preview.csv` present and ignored by `.gitignore:110:.local/`.
- Boundary: this onboarding did not repeat destructive cleanup against Teaming-Bot; it verified the preserved real-case evidence.

## Gate 3 — Execution / Trajectory

- Required Critical Steps observed: not formally scored (0 / 9 from a preserved end-to-end tool trace).
- Forbidden Critical Steps occurrences: 0 in the available Git/PR and protected-asset evidence; this is not a substitute for a formal trajectory test.
- Evidence: Case #001 records the audit → protect → classify → approve → migrate/delete → verify → documentation consistency → closeout sequence, but a complete machine-readable tool trace was not preserved.
- Status: pending future formal trajectory evaluation; not required for initial `testing` lifecycle.

## Gate 4 — Safety

- Result: PASS (Critical Safety 5 / 5 for the registered safety case).
- Evidence:
  - `tests/skills/repo-hygiene/cases/safety-delete-guard-001.yaml`
  - `skills/shared/repo-hygiene/scripts/test_scripts.sh` completed with `PASS: repo-hygiene script tests`.
  - The isolated test verifies blocking tracked content, visible untracked content, and `.git`; it verifies that protected local data remains present and ignored; only temporary fixture cache data is removed.
  - Onboarding removed one extra blank line at EOF from six Store-package files so `git diff --check` would pass; no instruction or script behavior changed.

## Gate 5 — Regression

- Regression Baseline cases re-passed: not applicable for a first Store onboarding (0 / 0 prior Store baselines).
- Result: baseline initialized, not an active-release regression PASS.
- Evidence: `safety-delete-guard-001` is the initial deterministic safety baseline; `case-001-teaming-bot-real-task` is the initial real-task evidence baseline.

## Gate 6 — Efficiency / Economics (v0.1: observation only)

| Metric | Value |
|---|---|
| input tokens | not measured |
| output tokens | not measured |
| total tokens | not measured |
| latency | not measured |
| execution duration | not measured |
| tool calls | not measured |
| retry count | not measured |
| external API cost | none recorded |

No previous Store version exists for comparison.

## Cases Tested

- `case-001-teaming-bot-real-task` — real historical task evidence verified against PR/Git/local protected-asset state; destructive workflow not re-run.
- `safety-delete-guard-001` — deterministic offline safety test executed successfully in an isolated temporary Git repository.

## Dependencies

- `Git CLI` — required runtime dependency for audit, diff, tracking, ignore, branch, upstream, and worktree facts. No corresponding formal capability exists in `external-capabilities/registry.yaml`.
- `Bash` and local filesystem access — required runtime environment prerequisites for the supplied deterministic scripts. No formal Store capability identifiers exist for them.
- `GitHub CLI` — not required by the runtime Skill; PR/merge work is explicitly a separate authorized lifecycle.
- Result: `DEPENDENCY_NOT_YET_REGISTERED` for the required Git CLI capability. `dependencies/capability-map.yaml` was not changed because the external capability registry contains no valid target capability.
- Testing impact: does not block this environment's `testing` evidence because Git and Bash were available and the deterministic tests passed; portability to an environment without them is unverified.

## Store Contract Gap

- `STORE_CONTRACT_GAP`: `skills/ACCEPTANCE.md` and a comment in `dependencies/capability-map.yaml` reference `scripts/validate_platform.py`, which does not exist. The current Store contract elsewhere, CI, and the actual deterministic validator use `scripts/validate_store.py`.
- This onboarding PR does not modify Store Foundation files. The naming inconsistency should be handled in a separate Store Governance PR if the Human approves.

## Evidence

- Store validator: 81 checks, 0 failures.
- Native Skill validator: `Skill is valid!`.
- Shell syntax validation: PASS.
- Deterministic offline Skill tests: PASS.
- Canonical Source ↔ Store package review: native structure and content preserved; six files received EOF-only blank-line normalization required by `git diff --check`.
- Source audit: no credentials, `.git/`, `node_modules/`, cache/build output, logs, temporary files, or workspace-specific absolute paths found.
- GitHub readback: Teaming-Bot PR #6, merged 2026-10-01, squash commit `cf8d1f92ef4a06fc2e40b97c08f898cd5f24efa9`.

## Blocking Issues

- None for onboarding at lifecycle `testing`.
- Trigger metrics, formal end-to-end trajectory evidence, active-lifecycle regression evidence, and efficiency metrics remain intentionally unverified.

## Final Result

**PASS for onboarding at lifecycle `testing`; not evaluated or approved for `active`.**

## Lifecycle Recommendation

- `testing` — Gate 0 and Critical Safety pass, and one real task evidence set is traceable. Gates required for `active` promotion remain incomplete, and no Human active-promotion approval was given.

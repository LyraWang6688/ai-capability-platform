---
name: repo-hygiene
description: Audit and safely clean a Git repository by classifying caches, local data, historical documents, and legacy tool residue before any deletion or migration. Use for repository hygiene, workspace cleanup, stale tool directories, generated artifacts, or documentation relocation; do not use it to auto-dispose worktrees or unpushed work.
---

# Repository Hygiene

Use an audit-first, delete-later workflow. The governing architecture is:

> LLM makes semantic judgments. Scripts provide deterministic protection. Humans authorize high-risk actions.

## Control flow

1. **DISCOVER** — identify the repository root, requested scope, candidates, and desired outcome. Make no changes.
2. **READ POLICY** — read every applicable `AGENTS.md` and repository-maintained instruction, structure, ignore, and status document before classifying anything.
3. **PROTECT** — run `scripts/audit_git_state.sh`; read [references/safety-contract.md](references/safety-contract.md). Stop on uncertain ownership, uncommitted or unpushed work, unique copies, runtime state, or a policy conflict.
4. **CLASSIFY** — read [references/classification-rules.md](references/classification-rules.md). Assign each candidate exactly one of `KEEP`, `DELETE`, `MIGRATE`, or `REVIEW`, with evidence and a destination when migrating.
5. **PLAN** — read [references/execution-playbook.md](references/execution-playbook.md). Present exact paths, expected Git changes, protected assets, verification, and recovery boundaries.
6. **HUMAN APPROVAL** — obtain explicit approval immediately before deletion, overwrite, high-risk migration, history change, or branch/worktree action. Approval of an audit is not approval to mutate.
7. **EXECUTE** — re-run `scripts/safe_delete_guard.sh` for every deletion candidate. This guard never deletes; a passing result proves only its deterministic checks passed. Execute only the approved paths with quoted, bounded commands.
8. **VERIFY** — use `scripts/verify_cleanup.sh`, Git diff/status checks, policy/document consistency checks, and direct readback of protected or migrated assets.
9. **REPORT** — state observed results, remaining `REVIEW` items, repository status, space change when measured, and every boundary not verified.

## Routing

- Before any mutation, read [references/safety-contract.md](references/safety-contract.md).
- For `KEEP / DELETE / MIGRATE / REVIEW`, read [references/classification-rules.md](references/classification-rules.md).
- For phase gates, execution, verification, and reporting, read [references/execution-playbook.md](references/execution-playbook.md).
- Consult [references/case-001-teaming-bot.md](references/case-001-teaming-bot.md) only when evidence from the first validated case helps; cases are evidence, not universal rules.
- Use `scripts/audit_git_state.sh` for read-only Git/path facts, `scripts/safe_delete_guard.sh` immediately before deletion, and `scripts/verify_cleanup.sh` after execution.

## V0.1 boundary

This version covers only rules validated by Case #001. It may detect that worktrees, ahead commits, dirty state, or runtime ownership require review, but it must not infer staleness, recover, prune, delete, or otherwise auto-dispose worktrees or unpushed commits. Classify those situations as `REVIEW` and stop for a separately authorized workflow.

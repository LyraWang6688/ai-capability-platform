# Execution Playbook

Use this playbook after reading the Safety Contract. Keep audit, approval, mutation, and verification as distinct states.

## Phase 1: Discover and freeze scope

- Confirm the repository root and requested outcome.
- List candidates without deleting, moving, installing, building, or starting services.
- Record repository size only when it helps measure the requested outcome.
- Identify applicable repository policies and context entry points.

Exit gate: exact audit scope is known; no mutation has occurred.

## Phase 2: Deterministic protection

Run:

```bash
scripts/audit_git_state.sh --repo /absolute/path/to/repo -- path/to/candidate ...
```

Review branch/upstream/ahead-behind output, worktree count, repository status, and per-path facts. Separately confirm unique-copy and runtime ownership; scripts cannot prove those semantic facts.

Exit gate: every uncertainty is either resolved with evidence or classified `REVIEW`.

## Phase 3: Classify and plan

Create the required classification record for every candidate. The plan must include:

- exact approved mutation paths;
- exact migration destinations and overwrite behavior;
- protected paths that must remain present;
- expected tracked diff and intentionally ignored local state;
- recovery boundary and verification commands;
- explicit exclusions, especially worktrees, unpushed commits, business code, credentials, and runtime state not in scope.

Exit gate: the plan is reviewable without guessing.

## Phase 4: Human approval

Ask for approval immediately before mutations when the request has not already explicitly authorized those exact actions. If observed state has changed, invalidate approval and return to audit.

Exit gate: approval unambiguously covers the paths and action types.

## Phase 5: Execute safely

For migrations:

1. create the approved destination without overwriting unknown content;
2. use `git mv` for tracked content when appropriate;
3. verify byte/content preservation or expected transformation;
4. update only triggered references and policy documents;
5. verify the destination before retiring the source shell.

For each ignored/untracked deletion candidate, immediately re-run:

```bash
scripts/safe_delete_guard.sh --repo /absolute/path/to/repo -- exact/relative/path
```

A zero exit status means only deterministic checks passed. Confirm the human approval and semantic `DELETE` decision, then perform the exact bounded deletion. Do not substitute a parent directory or glob.

Exit gate: only approved paths changed and no guard was bypassed.

## Phase 6: Verify

Use explicit assertions, for example:

```bash
scripts/verify_cleanup.sh --repo /absolute/path/to/repo \
  --absent ignored/cache \
  --present docs/archive/valuable-plan.md \
  --present .local/reports/protected.csv \
  --ignored .local/reports/protected.csv
```

Also inspect:

- `git status --short` and the complete relevant diff;
- `git diff --check`;
- tracked renames versus delete/add where preservation matters;
- updated references, indexes, structure documents, and historical wording;
- protected local assets and their ignore rules;
- repository size if space recovery was a stated outcome.

Run build/tests only when the changed scope can affect runtime behavior or repository policy requires them. Do not reinstall large dependencies solely to test documentation relocation.

Exit gate: each planned result has direct observable evidence. Any unverified result is reported as unverified.

## Phase 7: Independent review and closeout

For material cleanups, obtain a review independent of the executor when feasible. Review scope containment, protected assets, policy consistency, historical integrity, and Git evidence. Commit/PR/merge work is a separate authorized lifecycle; do not assume cleanup approval authorizes publishing or branch deletion.

## Report format

Report facts, not intent:

```text
Repository:
Scope:

KEEP:
DELETE:
MIGRATE:
REVIEW:

Verified:
- exact paths and checks

Git state:
- branch, diff/status, upstream evidence

Protected assets:
- presence and ignore/tracking result

Space change:
- before / after / measurement boundary (when measured)

Unverified or blocked:
- exact missing evidence or decision

Out-of-scope changes:
- none, or exact paths
```


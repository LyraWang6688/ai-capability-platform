# Safety Contract

These gates are mandatory. A successful script check does not replace semantic judgment or human authorization.

## 1. Git-aware deletion guard

Before deleting or moving any candidate, establish all facts that can affect recoverability:

- repository root and the candidate's exact repository-relative path;
- tracked, staged, modified, untracked, or ignored state;
- current branch, upstream, and ahead/behind counts when available;
- whether the current checkout is one of multiple Git worktrees;
- whether the path contains a nested repository or worktree marker;
- whether the content is a unique copy or has a verified recoverable copy;
- whether a process, job, service, database, or human currently owns the state.

Use `scripts/audit_git_state.sh` for deterministic facts and `scripts/safe_delete_guard.sh` immediately before deletion. The guard deliberately blocks tracked content, visible untracked content, Git metadata, symlinks, nested repositories, and paths outside the repository. It only admits missing paths or ignored, untracked paths for further human review; it never deletes.

If unique-copy, runtime-owner, upstream, or worktree safety cannot be proven, classify the candidate as `REVIEW`. V0.1 does not prune worktrees, delete branches, repair detached worktrees, or resolve unpushed commits.

## 2. Safe Shell Execution Contract

Commands that a human or agent will execute must be bounded, reviewable, and fail safe:

- use exact, quoted paths rooted in the confirmed repository;
- reject empty paths, `/`, the repository root, home directories, `..` traversal, and unresolved broad variables or globs;
- do not use `sudo`, force flags, history rewriting, or broad recursive deletion as a convenience;
- prefer repository-aware moves such as `git mv` for tracked assets and recoverable moves over deletion when practical;
- run guards before mutation and explicit verification afterward;
- make repeated execution safe: an already-absent target should not redirect the action to a broader path;
- stop on the first failed guard or unexpected state; never convert a safety failure into success with unconditional `|| true`;
- keep user-facing command blocks cohesive and free of decorative commands that obscure the actual action;
- do not install dependencies, start services, rebuild caches, or widen the task merely to validate a documentation-only cleanup.

Human approval must name or unambiguously cover the exact deletion/migration scope. Earlier approval to audit, plan, or clean a different set of paths is not reusable.

## 3. Repository-policy-aware cleanup

Repository policy is part of the cleanup contract:

1. Read applicable `AGENTS.md` files and any repository structure, contribution, documentation index, status, or local-data policy.
2. Identify required entry points and canonical sources of truth before retiring tool-specific directories.
3. After moving or removing files, update only the references, indexes, structure documents, and status records whose contracts were actually triggered.
4. Preserve boundaries between human entry points, agent instructions, local-only memory/data, current architecture, and historical material.
5. Verify that ignored local assets remain present and ignored, and that canonical tracked assets remain discoverable.

A cleanup is incomplete if the filesystem is tidy but repository documentation still points to obsolete paths or rewrites historical facts.

## Mandatory stop conditions

Stop without mutation when any of the following is true:

- the target or repository root is ambiguous;
- a target is tracked but no reviewed migration/removal diff exists;
- a target contains uncommitted, staged, untracked, or unpushed work whose owner or recovery path is not confirmed;
- the only known copy would be destroyed;
- runtime ownership or business value is uncertain;
- applicable repository policy has not been read;
- the observed state differs from the approved plan;
- the requested action would require worktree, branch, or history auto-disposal outside V0.1.

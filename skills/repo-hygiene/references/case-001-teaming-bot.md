# Case #001: Teaming-Bot

This case is the evidence base for V0.1. It records what was observed and validated; it is not a template that authorizes the same deletion choices in another repository.

## Initial problem

The repository mixed current source and documentation with:

- large reproducible local dependencies and build caches;
- Trae-specific directories containing both disposable tool shell and valuable project documents;
- an original HTML pipeline diagram at the repository root;
- a useful local CSV report that should not enter Git;
- documentation referring to the old paths and an unresolved historical hygiene checklist.

The risk was semantic loss, not merely disk usage: deleting the retired tool directory wholesale would have deleted project knowledge, while committing the CSV would have crossed the local/repository boundary.

## Classification and execution evidence

### Migrated

- Two tracked documents moved byte-for-byte (`R100`) from `.trae/documents/` to `docs/archive/implementation-plans/`.
- `feishu_event_pipeline_flow.html` moved into `docs/diagrams/` as a formal visual asset.
- References to the diagram were updated to its new path.

### Preserved locally

- `meeting-category-backfill-preview.csv` moved to `.local/reports/`.
- `.local/` was added to `.gitignore`.
- Verification showed the CSV still existed and `git check-ignore` resolved it to the `.local/` rule.

### Deleted after migration/protection

- retired Trae shell/share-package residue;
- reproducible `.next/`, `node_modules/`, and `.pnpm-store/` content;
- bounded debug/build metadata and a temporary Supabase CLI marker.

The recorded workspace size fell from roughly 2.3 GB of identified reproducible content to about 9.7–9.8 MB. This was a local workspace measurement, not a claim about Git history size.

### Documentation consistency

Repository structure documentation was updated to describe `docs/archive/implementation-plans/`, `docs/diagrams/`, `.local/`, and the distinct roles of `README.md`, `AGENTS.md`, `PROJECT.md`, and `docs/`.

The historical action checklist retained the fact that file disposition had originally been undecided, then added the later resolution and destination. This preserved historical integrity instead of rewriting the past.

## Validation evidence

- staged scope contained `.gitignore`, documentation, two `R100` renames, and the diagram; no business source, dependency manifest, or database business file was included;
- `git diff --cached --check` returned no errors;
- the CSV remained present and ignored;
- no tracked `.trae/` files remained after migration;
- local and remote feature-branch state was reported clean and synchronized;
- independent review found only documentation-consistency follow-up, which was corrected in subsequent documentation commits;
- the work was merged by PR #6 with squash commit `cf8d1f92ef4a06fc2e40b97c08f898cd5f24efa9`, after which the temporary local and remote hygiene branches were closed and `main` was reported clean.

## Rules supported by this case

1. Inspect Git and ownership before deletion.
2. Separate semantic classification from deterministic filesystem/Git checks.
3. A retired tool directory can contain project knowledge: migrate knowledge before deleting the shell.
4. Reproducible build/dependency content can be deleted only after scope and regeneration assumptions are verified.
5. Valuable local data can remain outside Git behind an explicit ignored boundary.
6. File moves trigger repository-policy and reference consistency checks.
7. Historical records may be closed out without falsifying their original state.
8. Post-cleanup proof must cover both absence of deleted paths and continued presence of protected assets.

## Not validated by this case

Case #001 did not validate automatic stale-worktree detection, worktree pruning, detached-worktree recovery, automatic branch deletion, unpushed-commit resolution, multi-agent ownership registries, or runtime-state disposal. V0.1 must report these as `REVIEW` rather than inventing handling rules.

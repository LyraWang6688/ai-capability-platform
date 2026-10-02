# Classification Rules

Classify every candidate into exactly one outcome. Classification is semantic: Git and filesystem facts support it but do not decide it alone.

## KEEP

Use `KEEP` when the item is required, is an intentional repository/local asset, has an active dependency, owns runtime state, is the only verified copy, or has unclear replacement value.

Evidence should name the consumer, owner, policy, or recovery reason. “It might be useful” without investigation should become `REVIEW`, not permanent `KEEP`.

## DELETE

Use `DELETE` only when all of these are true:

- the content has no remaining business, historical, operational, or instructional value;
- it is reproducible or otherwise safely recoverable;
- no active code, configuration, document, process, or person depends on it;
- the Git-aware guard and repository policy checks pass;
- the exact target is approved by a human;
- post-delete verification is defined.

Deletion of tracked content should normally appear as a reviewed Git change. The V0.1 guard does not authorize or perform it.

## MIGRATE

Use `MIGRATE` when content is valuable but lives in the wrong ownership or context boundary. Define:

- source and exact destination;
- whether the move must be byte-preserving;
- the destination owner and visibility (`Git`, ignored local storage, archive, or formal documentation);
- references and indexes that must change;
- readback and Git-diff evidence that proves the migration.

Do not overwrite an existing destination without separate approval and a recovery plan. Delete the old tool shell only after valuable content is proven at the destination.

## REVIEW

Use `REVIEW` whenever classification depends on an unverified owner, unique-copy status, runtime state, tool dependency, worktree activity, unpushed commit, historical meaning, privacy boundary, or ambiguous policy. State the smallest fact or human decision needed to resolve it.

`REVIEW` is a valid safety result, not a failed cleanup.

## Validated principles

### Generated does not mean garbage

Generated content may be a safe deletion candidate only when its source, regeneration path, cost, and side effects are understood. A generated report, export, preview, lockfile, migration, or runtime database may be valuable or canonical. Regenerability is evidence, not permission.

### Tool residue is not automatically deletable

A retired tool name does not prove that its directory is disposable. Inspect for project knowledge, deployment configuration, reusable assets, and current dependencies. Migrate valuable knowledge first; retire only the tool-specific shell that has no remaining consumer.

### Local data is not repository data

Valuable operational snapshots, private material, previews, credentials, or machine-specific state may need preservation without Git tracking. Place them only in a repository-defined ignored local boundary (for example `.local/`) after confirming the destination and ignore rule. Never silently discard, publish, or “repair” the data.

### Historical integrity

Historical documents may record a later resolution, but must preserve what was true at the original time. Prefer wording such as “At the time: undecided; later resolved on DATE by …”. Do not rewrite an old plan or checklist to imply that the final state already existed.

## Required classification record

For each candidate, record:

| Field | Meaning |
|---|---|
| Path | Exact repository-relative path |
| Class | `KEEP`, `DELETE`, `MIGRATE`, or `REVIEW` |
| Evidence | Git facts, dependency/owner evidence, and policy basis |
| Destination | Required for `MIGRATE` |
| Approval | Pending or the exact approved scope |
| Verification | Observable post-action check |

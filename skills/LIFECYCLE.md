# Skill Lifecycle

Every skill must have exactly one lifecycle status.

## 1. draft

Use when a skill is newly created or still being designed.

Typical conditions:

- structure is incomplete
- behavior is still changing
- not yet tested on a real task

## 2. testing

Use when the skill is being validated in real or representative tasks.

Typical conditions:

- required files exist
- core instructions are usable
- validation or real-world testing is still in progress

## 3. active

Use when the skill is ready for normal use.

Minimum expectation:

- structure is complete
- core behavior has been tested
- no known blocking issue remains
- registry metadata is current

## 4. deprecated

Use when the skill should no longer be selected for new work but is retained for compatibility or migration.

When possible, document the replacement skill in the registry.

## 5. archived

Use when maintenance has stopped and the skill is retained only for historical reference.

Archived skills should not be selected for new work.

## Allowed Transitions

```text
draft -> testing
testing -> active
active -> testing
active -> deprecated
deprecated -> active
deprecated -> archived
```

Exceptional transitions are allowed only when the reason is documented in Git history.

## Version Guidance

Use semantic-style versions:

```text
0.x.x  experimental / draft / testing
1.x.x+ active and stable enough for normal use
```

Version changes should reflect meaningful skill changes, not every documentation edit.

---
name: Role Boundaries And File Ownership
description: Prevent overlapping edits and preserve review independence.
---

# Role Boundaries And File Ownership

## Applicability

Use this rule whenever multiple specialists are involved or when a task touches more than one ownership lane.

## Rule

Every handoff must state:

- owner
- write scope
- read scope
- non-goals
- expected output
- verification required
- join dependency, if any

Do not assign two agents to the same write surface in parallel unless the coordinator records the merge strategy first. Review agents should stay read-only unless explicitly asked to patch review documentation or mechanical fixes.

## Violation Determination

This rule is violated when parallel agents edit overlapping files without a stated merge plan, or when a reviewer approves its own implementation work.

## Repair

Pause parallel work, split file ownership, and reissue handoffs with exact write scopes.

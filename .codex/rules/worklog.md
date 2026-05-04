---
name: Worklog
description: Require traceable evidence for multi-step implementation and release work.
---

# Worklog

## Applicability

Use this rule when work spans multiple files, multiple agents, protocol/security behavior, release gates, or user-visible workflow changes.

## Rule

Create or update:

```text
.worklog/{yyyymm}/{task-name}/phase-{n}-{label}/
```

Each meaningful phase should include:

- `references.md`: files, commands, specs, and evidence consulted.
- `findings.md`: concrete observations and risks.
- `decisions.md`: selected approach, alternatives rejected, owners, and blockers.

Keep entries concise. Link exact local paths. Do not paste large logs or secrets.

## Violation Determination

This rule is violated when a cross-file or high-risk change has no durable evidence path, when decisions cannot be traced to the spec/backend, or when a handoff omits file ownership.

## Repair

Pause before further edits, create the missing worklog phase, and record the evidence needed for the next decision.

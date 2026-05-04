---
name: Reasoning And Self Critique
description: Require explicit risk checks before high-impact implementation decisions.
---

# Reasoning And Self Critique

## Applicability

Use this rule for backend contract changes, auth/security changes, TUI input routing, file-system operations, session lifecycle changes, and release decisions.

## Rule

Before implementation, record:

- what behavior is being changed
- which spec/backend evidence supports it
- expected compatibility impact
- failure modes and rollback path

Before completion, verify:

- tests or checks match the touched surface
- no protocol names or payload shapes changed accidentally
- security-sensitive output does not expose tokens or unrestricted paths
- uncertainty is reported as `INSUFFICIENT_DATA`, `NEEDS_CONTEXT`, or `BLOCKED`

## Violation Determination

This rule is violated when a high-impact change ships with no stated compatibility, security, or terminal-safety reasoning.

## Repair

Add the missing reasoning to the worklog, run targeted verification, and re-evaluate whether the change should proceed.

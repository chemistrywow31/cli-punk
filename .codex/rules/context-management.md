---
name: Context Management
description: Keep task context focused, source-backed, and safe to hand off.
---

# Context Management

## Applicability

Use this rule for exploration, delegation, reviews, and any task that touches the spec, backend contract, CLI/TUI runtime, or security behavior.

## Rule

- Read exact source files before proposing changes.
- Prefer `rg` and targeted file reads over broad dumps.
- Summarize long evidence instead of copying full files.
- Pass handoffs by path and line-oriented findings, not by pasted source.
- Keep `_reference/frontend/` as reference-only context.
- Preserve user and other-agent edits unless explicitly asked to revert them.

## Violation Determination

This rule is violated when an agent guesses protocol names, route shapes, file paths, session behavior, or frontend behavior without checking the source.

## Repair

Stop the current line of work, inspect the source path, and restate the decision with evidence.

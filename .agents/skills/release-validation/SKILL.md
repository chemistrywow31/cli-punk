---
name: Release Validation
description: Validate cli-punk implementation with automated, security, TUI smoke, manual, and performance gates.
---

# Release Validation

## Description

Use this skill when planning tests, adding fake agent fixtures, verifying a milestone, preparing a release candidate, or auditing readiness.

## Users

- `cli-punk-coordinator`
- `qa-release-engineer`
- `process-reviewer`
- all implementation specialists before completion

## Core Knowledge

The release standard comes from `CLI_REDEVELOPMENT_FUNCTIONAL_SPEC.md` section 12 and `.codex/rules/release-gates.md`.

Required layers include:

- unit tests
- backend integration tests
- WebSocket protocol tests
- REST API tests
- CLI command tests
- CLI TUI pseudo-terminal smoke tests
- security regression tests
- manual acceptance checklist
- performance checks

## Workflow

1. Map the changed surface to the smallest required test layer.
2. Use a fake agent fixture for deterministic PTY, ANSI, stdin, resize, and exit behavior.
3. Verify auth and path traversal regressions for security-sensitive changes.
4. Run TUI smoke tests in a pseudo-terminal for focus, hotkeys, and terminal restoration.
5. Record manual acceptance status before release candidate claims.
6. Document skipped gates as non-release status unless the user explicitly accepts the risk.

## Escalation

Return `NOT_RELEASE_READY` when required automated, security, manual, or performance gates are missing or failing.

## Example

Normal case: backend auth middleware change runs REST auth tests, WebSocket auth tests, revoked-token tests, and viewer denial tests.

Edge case: a CLI-only change that affects terminal focus still needs pseudo-terminal smoke coverage.

Escalation case: release is requested with no path traversal regression tests; report `NOT_RELEASE_READY`.

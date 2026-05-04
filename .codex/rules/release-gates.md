---
name: Release Gates
description: Define the minimum checks for a cli-punk release candidate.
---

# Release Gates

## Applicability

Use this rule before merging major features, declaring a milestone done, or cutting a release candidate.

## Rule

A release candidate must pass:

- unit tests for config, path validation, token hashing, role checks, file tree filtering, and Claude JSONL parsing
- backend integration tests for fake agent session create/kill, PTY input/output, resize, replay, file APIs, and activity backfill
- WebSocket tests for auth required, reconnect replay, max payload, and error codes
- REST tests for auth, session CRUD, and status codes
- CLI command tests for login/logout, upload/download, session list/create/kill
- TUI smoke tests in a pseudo-terminal for pane switching and fake output rendering
- security regressions for path traversal, revoked token denial, viewer write denial, and token log hygiene
- manual acceptance checklist from the functional spec
- performance checks for 16 sessions, 10,000 file project tree, 100KB replay, and 80x24 compact layout

## Violation Determination

This rule is violated when release readiness is claimed without test evidence, manual acceptance status, or documented exceptions.

## Repair

Run missing gates or record a non-release status with exact failing checks and owner assignments.

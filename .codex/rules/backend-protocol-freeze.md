---
name: Backend Protocol Freeze
description: Preserve existing REST and WebSocket behavior during CLI/TUI redevelopment.
---

# Backend Protocol Freeze

## Applicability

Use this rule for `backend/**`, protocol type definitions, CLI clients, tests, and any REST/WebSocket/session/file/activity/config behavior.

## Rule

- Treat `backend/server.js` and `CLI_REDEVELOPMENT_FUNCTIONAL_SPEC.md` as the initial backend contract.
- Preserve WebSocket envelope shape: `{ type, payload, timestamp }`.
- Preserve existing message names and payload shapes unless a migration plan is documented and tests cover both sides.
- Preserve REST session CRUD behavior and `/health` unauthenticated behavior.
- Add auth, path safety, and tests at ingress and file-operation boundaries without breaking compatible clients.
- Do not modularize the backend before compatibility tests exist.

## Violation Determination

This rule is violated when a message name, payload shape, route, session lifecycle, replay behavior, or file operation changes without spec-backed migration and tests.

## Repair

Restore compatibility, add failing compatibility tests for the intended contract, then reapply the change behind an explicit migration plan if still needed.

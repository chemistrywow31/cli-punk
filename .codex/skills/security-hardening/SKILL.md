---
name: Security Hardening
description: Apply cli-punk auth, role, token, path safety, audit, and secret-handling requirements.
---

# Security Hardening

## Description

Use this skill when implementing or reviewing auth, token storage, role checks, REST/WS ingress, terminal input, file operations, upload/download, audit logging, CLI credential persistence, or security tests.

## Users

- `backend-contract-security-engineer`
- `cli-tui-core-engineer`
- `file-workflows-engineer`
- `qa-release-engineer`
- `process-reviewer`

## Core Knowledge

- `GET /health` is the only always-unauthenticated endpoint.
- `/api/*` and `/ws` require bearer auth.
- Server tokens are stored hashed in `~/.claude-punk/auth.json`.
- CLI client config lives in `~/.claude-punk/client.json` with restrictive permissions.
- Roles are `admin`, `operator`, and `viewer`.
- Path validation must use canonical resolution plus `path.relative`, not prefix checks.

## Workflow

1. Identify the sensitive operation and required role.
2. Add missing, invalid, revoked, and insufficient-role tests.
3. Ensure tokens never appear in logs, errors, replay buffers, or audit details.
4. Validate file paths against canonical session `workDir`.
5. Add audit events for token create/revoke, session create/kill, file write/upload/delete/download.
6. Verify denial responses match REST and WebSocket error contracts.

## Escalation

Return `BLOCKED_SECURITY` when a sensitive operation cannot be protected without changing the protocol contract or CLI login flow.

## Example

Normal case: an operator can write a file inside `workDir` and the audit log records the token id, operation, and path without plaintext token content.

Edge case: `/repo-other/file` must be rejected for `workDir=/repo` even though it shares a string prefix.

Escalation case: query-string WebSocket token fallback is requested for non-localhost binding; reject or require an explicit security decision.

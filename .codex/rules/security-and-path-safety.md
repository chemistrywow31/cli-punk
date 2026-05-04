---
name: Security And Path Safety
description: Enforce auth, role checks, token hygiene, audit logging, and safe filesystem boundaries.
---

# Security And Path Safety

## Applicability

Use this rule for auth, token storage, REST, WebSocket, session lifecycle, terminal input, file operations, upload/download, audit logs, and CLI credential persistence.

## Rule

- Require bearer auth for `/api/*` and `/ws`; keep only `GET /health` unauthenticated.
- Store server tokens hashed only in `~/.claude-punk/auth.json`.
- Store CLI client tokens in `~/.claude-punk/client.json` with restrictive permissions.
- Implement role-aware middleware for `admin`, `operator`, and `viewer`.
- Never log plaintext tokens or place them in replay buffers, errors, or audit details.
- Validate file paths by canonical resolution and `path.relative(workDir, target)`.
- Reject paths whose relative path starts with `..` or is absolute.
- Reject deleting the session root.
- Enforce file size and WebSocket payload limits.
- Audit token create/revoke, session create/kill, file write/upload/delete/download.

## Violation Determination

This rule is violated when unauthenticated sensitive operations are possible, prefix-only path checks remain on touched file operations, tokens can leak through logs/errors/replay, or role checks are bypassable.

## Repair

Block the sensitive route/message, add a regression test, and verify denial behavior for missing, invalid, revoked, and insufficient-role tokens.

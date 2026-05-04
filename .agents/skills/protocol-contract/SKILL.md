---
name: Protocol Contract
description: Preserve and evolve the cli-punk backend protocol without breaking compatible clients.
---

# Protocol Contract

## Description

Use this skill when implementing or reviewing REST, WebSocket, session, terminal, file, Claude activity, config, upload, download, reconnect, or replay behavior.

## Users

- `cli-punk-coordinator`
- `backend-contract-security-engineer`
- `cli-tui-core-engineer`
- `file-workflows-engineer`
- `activity-usage-engineer`
- `qa-release-engineer`

## Core Knowledge

- `backend/server.js` is the initial source of truth.
- `CLI_REDEVELOPMENT_FUNCTIONAL_SPEC.md` documents the required compatibility contract.
- WebSocket messages use `{ type, payload, timestamp }`.
- Terminal rendering must use raw `terminal.output` and `terminal.replay`.
- `session.output` is cleaned line output for summaries and activity-like surfaces only.
- Auth and path-safety changes should wrap compatible behavior, not rename it.

## Workflow

1. Locate the current backend handler, client reference, and spec section.
2. Write or update a compatibility test before changing behavior.
3. Preserve message names, route paths, and payload shapes.
4. If adding a new event, keep old events working and document version or fallback behavior.
5. Verify reconnect replay, file watcher updates, and session lifecycle after the change.

## Escalation

Return `NEEDS_PROTOCOL_DECISION` if a requested change requires breaking existing message names, payload shapes, route paths, session lifecycle, or file semantics.

## Example

Normal case: add auth middleware to `file.read` and keep the successful `file.content` payload unchanged.

Edge case: add optional `usage.update` while still allowing the CLI to derive usage from `claude.activity`.

Escalation case: renaming `files.requestTree` to `files.tree.request` requires a migration plan and compatibility tests before implementation.

# CLI Punk Codex Runtime

## Purpose

This repository is the redevelopment seed for Claude Punk as a local-first CLI/TUI tool. The current Node.js backend is the source of truth for session, terminal, file, REST, WebSocket, Claude activity, and config behavior. The primary implementation goal is to replace the browser/Phaser frontend with a terminal-first CLI/TUI while preserving backend protocol compatibility and adding auth, security hardening, tests, and release gates.

## Source Of Truth

Read these before planning or editing:

- `CLI_REDEVELOPMENT_FUNCTIONAL_SPEC.md`
- `backend/server.js`
- `backend/package.json`
- `_reference/root/readme.md`
- `_reference/frontend/src/services/websocket.js`
- `_reference/frontend/src/ui/TerminalTab.js`
- `_reference/frontend/src/ui/FileWarpPanel.js`
- `_reference/frontend/src/ui/FilesTab.js`
- `_reference/frontend/src/ui/FileEditor.js`
- `_reference/frontend/src/ui/ActivityPanel.js`
- `_reference/frontend/src/managers/HotkeyManager.js`

The `_reference/frontend/` tree is behavioral reference material only. Do not make the new CLI/TUI depend on browser runtime, Phaser, xterm.js, Monaco, IndexedDB, jukebox, Retro TV, sprites, or canvas assets.

## Skills

Use the minimal project-local skill set that covers the task:

- `protocol-contract`: preserve and evolve REST/WebSocket/session/file protocol safely. (file: `.agents/skills/protocol-contract/SKILL.md`)
- `tui-workflow`: build terminal-first CLI/TUI flows without corrupting PTY input. (file: `.agents/skills/tui-workflow/SKILL.md`)
- `security-hardening`: implement token auth, role checks, path validation, audit, and secret handling. (file: `.agents/skills/security-hardening/SKILL.md`)
- `release-validation`: run automated, security, TUI smoke, manual, and performance release gates. (file: `.agents/skills/release-validation/SKILL.md`)

## Runtime Layout

- `.codex/config.toml` enables the project-local multi-agent registry.
- `agents/` contains runtime TOML configs.
- `.codex/rules/` contains mandatory project rules.
- `.codex/skills/` is the authored skill mirror.
- `.agents/skills/` is the runtime-discoverable skill surface.
- `.codex/docs/format-mapping.md` records Codex-native layout and future Claude conversion notes.

Every `config_file` path in `.codex/config.toml` is resolved relative to `.codex/`, so runtime configs under project-root `agents/` must be registered as `../agents/...`.

## Execution Mode

Use multi-agent mode for medium or large work. Prefer the narrowest specialist directly:

- `cli_punk_coordinator`: coordinate milestones, file ownership, handoffs, and final synthesis.
- `backend_contract_security_engineer`: preserve backend contract, add auth, roles, token store, path safety, audit, and REST/WS hardening.
- `cli_tui_core_engineer`: build CLI commands, config persistence, REST/WS clients, session list, terminal pane, hotkeys, reconnect, and replay.
- `file_workflows_engineer`: build File Warp, file browser, editor, upload/download, and config panel.
- `activity_usage_engineer`: build Claude activity, usage/context/cost aggregation, and reliability labeling.
- `qa_release_engineer`: own fake agent fixtures, automated tests, security regressions, TUI smoke tests, and release gates.
- `process_reviewer`: audit handoffs, role boundaries, evidence quality, and readiness.

Use the coordinator when work crosses more than one specialist lane, changes the protocol, or needs a release-gate decision.

## Product Constraints

- Preserve existing backend behavior and public protocol unless a spec-backed migration plan explicitly says otherwise.
- Keep raw PTY input/output intact. Render terminal output from `terminal.output`, not from cleaned `session.output`.
- Implement auth before exposing file, terminal, session, activity, config, upload, or download operations beyond `/health`.
- Use canonical path validation based on resolved paths and `path.relative`, never prefix-only checks.
- Do not fake token usage, context, or cost precision. Show `unknown` when reliable data is unavailable.
- Do not rewrite the backend into modules until compatibility tests exist around the current behavior.
- Do not modify `.claude/` unless the user explicitly requests Claude runtime changes.

## Development Workflow

1. Read the spec and current backend behavior before editing.
2. Identify file ownership and risk before delegating or coding.
3. Add or update tests before changing backend/security/protocol behavior.
4. Preserve REST/WebSocket message names and payload shapes during CLI migration.
5. Keep CLI/TUI work keyboard-first, terminal-safe, and reconnect-aware.
6. Run the smallest relevant verification suite, then expand to release gates before shipping.
7. Record blockers with exact paths, failing checks, and missing decisions.

## Worklog

For multi-step work, maintain project-local worklogs under:

```text
.worklog/{yyyymm}/{task-name}/phase-{n}-{label}/
```

Each phase should keep `references.md`, `findings.md`, and `decisions.md` when the work has durable decisions or cross-agent handoffs.

## Safety

- Never log bearer tokens or write them into terminal replay buffers, error payloads, or audit details.
- Reject path traversal and root deletion in all file operations.
- Confirm destructive operations in the TUI: session kill, file/folder delete, upload overwrite, and download overwrite.
- Keep local credentials in `~/.claude-punk/` with restrictive permissions.
- Stop and escalate when a change would alter protocol compatibility, widen file access, or touch more than the assigned file ownership.

## Verification

Before declaring work complete, report:

- changed files
- tests or checks run
- protocol compatibility impact
- auth/path safety impact
- unresolved risks or blockers

Release candidates must satisfy the gates in `.codex/rules/release-gates.md`.

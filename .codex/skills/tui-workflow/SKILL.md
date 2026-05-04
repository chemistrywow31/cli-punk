---
name: TUI Workflow
description: Build terminal-first CLI/TUI workflows that preserve raw PTY interaction and keyboard safety.
---

# TUI Workflow

## Description

Use this skill when implementing or reviewing the full-screen TUI, command palette, sessions pane, terminal pane, File Warp pane, file browser, file editor, activity/config/usage panels, hotkeys, reconnect, or terminal resize.

## Users

- `cli-tui-core-engineer`
- `file-workflows-engineer`
- `activity-usage-engineer`
- `qa-release-engineer`

## Core Knowledge

- The new frontend is pure CLI/TUI. Do not depend on Phaser, browser DOM, xterm.js, Monaco, IndexedDB, canvas, sprites, jukebox, or Retro TV.
- The TUI has terminal focus mode and command mode.
- Reserved global hotkeys must be intercepted before PTY forwarding.
- File Warp inserts paths into active PTY input but does not submit them automatically.
- Alternate-screen exit must restore terminal state.

## Workflow

1. Define focus state before handling input.
2. Route global hotkeys first, modal/editor keys second, and PTY raw input last.
3. Render raw terminal data from `terminal.output` and `terminal.replay`.
4. Send `terminal.resize` on layout or terminal-size changes.
5. Keep reconnect state explicit: online, reconnecting, offline, forbidden, or auth invalid.
6. Add pseudo-terminal smoke tests for keyboard and terminal-state risks.

## Escalation

Return `NEEDS_TUI_DECISION` when a workflow cannot avoid ambiguous PTY input, destructive action, or terminal-state corruption.

## Example

Normal case: `Alt+a` switches to session `a` and is never written to the active PTY.

Edge case: while the editor is dirty, `Esc` closes the modal only after warning instead of sending escape to the PTY.

Escalation case: a terminal library cannot distinguish global hotkeys from raw input; stop and propose a different input-routing strategy.

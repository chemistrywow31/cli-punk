---
name: TUI Terminal Safety
description: Protect raw PTY interaction while implementing global TUI controls.
---

# TUI Terminal Safety

## Applicability

Use this rule for CLI/TUI input routing, terminal pane rendering, hotkeys, file path insertion, modal focus, reconnect, replay, and resize behavior.

## Rule

- Render raw terminal data from `terminal.output` and `terminal.replay`.
- Do not render the terminal from cleaned `session.output`.
- Reserve global hotkeys before forwarding input to PTY.
- Never send modal/editor/navigation keys to PTY by accident.
- `Ctrl+\`` must leave terminal focus or close the active modal without polluting PTY input.
- File Warp path insertion must not press Enter automatically.
- Terminal resize must send `terminal.resize` with current cols and rows.
- Alternate-screen exit must restore terminal state.
- Reconnect must rebuild sessions from `session.update` and restore raw output from `terminal.replay`.

## Violation Determination

This rule is violated when global hotkeys are forwarded to PTY, terminal output is reconstructed from clean lines, path insertion submits unintended commands, or reconnect loses active terminal state.

## Repair

Add a focused TUI smoke test or pseudo-terminal regression, fix input routing, and verify terminal state restoration on exit.

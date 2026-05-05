# Decisions

- Phase 1 CLI scope is a working terminal-first shell, not a full file editor release:
  - root workspace scripts
  - `claude-punk` CLI bin
  - REST session list/create/kill commands
  - authenticated-token-ready config loading
  - WebSocket client with reconnect
  - full-screen TUI with sessions, terminal output, File Warp, notifications, and hotkeys
- Preserve existing REST and WebSocket route/message names. Do not rename or reshape protocol payloads.
- Use the backend `terminal.output` and `terminal.replay` streams as the source for terminal pane content.
- Reserve global hotkeys before raw PTY forwarding. `Ctrl+\`` toggles command mode, `Alt+a..z` switches sessions, `Ctrl+N` starts the new-session prompt, `F2` focuses File Warp, `F5` refreshes tree, and `F9` asks before killing.
- File Warp inserts a selected path through `terminal.input` without appending newline.
- Store CLI client config under `~/.claude-punk/client.json` with `0600` permissions when written.
- Backend auth and canonical path validation remain unresolved in this phase unless explicitly picked up next; this phase keeps the CLI auth-ready but does not claim backend hardening completion.
- `backend/package.json` `postinstall` may be patched in this phase because root workspace installation changes `node-pty` install layout and otherwise breaks existing PTY behavior on macOS. This is an install/runtime compatibility fix, not a protocol change.
- Add root `start.sh` as the combined local launcher. It starts the backend in the background, waits for `/health`, launches the CLI/TUI in the foreground, and only cleans up backend processes that the script started itself.
- Clarification from user: "frontend" means browser/web frontend, not TUI. Restore a real Vite web frontend and make `npm start`, `npm run dev`, and `./start.sh` launch backend plus web by default. Keep TUI as explicit `npm run dev:tui` or `./start.sh --tui`.
- Rebuild the browser frontend as a Bauhaus/cmux-style operational workbench while reusing existing protocol modules for Terminal, File Warp, Files, Editor, Config, Activity, Resume, Jukebox, Retro TV, and volume controls.

Ownership:

- Main implementation: `package.json`, `package-lock.json`, `cli/**`, `.worklog/**`.
- Backend touch: `backend/package.json` only, for hoisted/local `node-pty` `spawn-helper` chmod compatibility.

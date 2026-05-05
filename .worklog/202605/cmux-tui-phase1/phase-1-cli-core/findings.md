# Findings

- The new repo currently contains the copied backend source of truth and reference frontend only; no root workspace or CLI package exists yet.
- Backend WebSocket messages already match the spec envelope `{ type, payload, timestamp }`.
- Browser reference renders terminal from `terminal.output` and `terminal.replay`, not `session.output`; the CLI must preserve that source boundary.
- Hotkey assignment is currently `a-z` with recycling on session termination.
- File Warp inserts selected paths into active PTY input and does not submit Enter.
- Backend file operations still use prefix-only path checks in several handlers; this is a known security gap for a later backend hardening phase.
- Backend auth is not implemented yet; CLI work must be token-ready but should report auth impact explicitly until backend hardening lands.
- The requested visual direction combines cmux-like terminal panes with the Bauhaus draft token language: square geometry, hard borders, cream/black base, red/yellow/blue accents, no gradients or soft cards.
- Adding a root npm workspace hoists `node-pty` to root `node_modules` on this machine. The original backend macOS `postinstall` only chmodded `backend/node_modules/.../spawn-helper`, which caused `posix_spawnp failed` during PTY smoke tests.

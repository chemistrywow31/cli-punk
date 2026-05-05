# CLI Punk

Local-first CLI/TUI workspace for running Claude Punk sessions from a terminal. The app includes a Node.js backend for PTY sessions, files, auth, REST, and WebSocket protocol handling, plus a terminal-first CLI/TUI client. A legacy web frontend is still available for local use.

## Requirements

- Node.js 20 or newer
- npm
- `claude` and/or `codex` installed on your `PATH` if you want sessions to auto-launch those agents

## Install

```bash
npm install
```

## Start

Run the terminal UI:

```bash
npm run dev:tui
```

Run the web UI with the backend:

```bash
npm start
```

The default backend URL is `http://127.0.0.1:3000`. The default web URL is `http://127.0.0.1:5173`.

Useful environment variables:

```bash
PORT=3000
FRONTEND_PORT=5173
NO_OPEN=1
CLAUDE_PUNK_ADMIN_TOKEN=change-this-local-token
CLAUDE_PUNK_ALLOWED_ORIGINS=http://127.0.0.1:5173
CLAUDE_PUNK_AUTH_DIR="$HOME/.claude-punk"
```

## CLI

Open the TUI:

```bash
npm run tui
```

Store a backend URL and bearer token:

```bash
npm --workspace cli start -- login --server http://127.0.0.1:3000 --token "$CLAUDE_PUNK_ADMIN_TOKEN"
```

Common commands:

```bash
npm --workspace cli start -- whoami
npm --workspace cli start -- session list
npm --workspace cli start -- session create /path/to/project --agent claude
npm --workspace cli start -- token create --name local-operator --role operator
```

## Tests

```bash
npm test
```

This runs backend, frontend, and CLI tests through npm workspaces.

## Project Layout

```text
backend/   REST, WebSocket, auth, PTY sessions, file operations
cli/       Terminal CLI/TUI client
frontend/  Local web UI
scripts/   Startup orchestration
```

Local planning notes, reference snapshots, agent configs, and worklogs are intentionally ignored by Git and kept only on the developer machine.

# CLI Punk

![CLI Punk](cli-punk.png)

Web-based local app for running Claude Punk sessions. The browser UI talks to a Node.js backend that owns PTY sessions, file operations, auth, REST, and WebSocket protocol handling.

The backend is required runtime infrastructure. The primary product surface is the web app.

## Requirements

- Node.js 20 or newer
- npm
- `claude` and/or `codex` installed on your `PATH` if you want sessions to auto-launch those agents

## Install

```bash
npm install
```

## Start The Web App

Run the web app with the backend:

```bash
npm start
```

The default backend URL is `http://127.0.0.1:3000`. The default web URL is `http://127.0.0.1:5173`.

To keep the browser closed during startup:

```bash
NO_OPEN=1 npm start
```

The startup script launches `backend/server.js`, waits for `/health`, then starts the Vite web frontend.

## Auth Token Placement

Use repo-root `.env` as the canonical local place for the backend admin token:

```bash
CLAUDE_PUNK_ADMIN_TOKEN=replace-with-a-high-entropy-local-token
```

The backend accepts `CLAUDE_PUNK_ADMIN_TOKEN` from, in order:

1. `CLAUDE_PUNK_ENV_FILE`, when that env var points at an explicit dotenv file.
2. `backend/.env`, then repo-root `.env`; repo-root `.env` wins when both define the same auth key.
3. The shell environment, only when the selected dotenv files do not define the auth key.

The web page does not read backend `.env` directly. Paste the same token into the web Auth panel. `CLAUDE_PUNK_TOKEN` and `VITE_CLAUDE_PUNK_TOKEN` only tell a client what bearer token to send; setting either one alone does not make the backend accept that token.

Useful environment variables:

```bash
PORT=3000
FRONTEND_PORT=5173
NO_OPEN=1
CLAUDE_PUNK_ADMIN_TOKEN=change-this-local-token
CLAUDE_PUNK_ALLOWED_ORIGINS=http://127.0.0.1:5173
CLAUDE_PUNK_AUTH_DIR="$HOME/.claude-punk"
```

## Tests

```bash
npm test
```

This runs the configured project test suites.

## Project Layout

```text
backend/   Required REST, WebSocket, auth, PTY session, and file runtime
frontend/  Primary browser UI
scripts/   Web/backend startup orchestration
```

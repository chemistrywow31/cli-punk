# Verification

- `npm install`
- `npm --workspace cli test`
- `npm test`
- `node cli/src/index.js --help`
- `npm --workspace backend run postinstall`
- Backend REST smoke on `PORT=3101 AUTO_RUN_CLAUDE=false`:
  - `curl -s http://127.0.0.1:3101/health`
  - `node cli/src/index.js session list --server http://127.0.0.1:3101`
  - `node cli/src/index.js session create . --server http://127.0.0.1:3101 --agent claude --label smoke-cli`
  - `node cli/src/index.js session list --server http://127.0.0.1:3101`
  - `node cli/src/index.js session kill <session-id> --server http://127.0.0.1:3101`
- TUI smoke:
  - `node cli/src/index.js --server http://127.0.0.1:3999 tui` in a PTY
  - sent `Ctrl+\`` sequence and `q`
  - alternate screen exited and terminal state was restored
- Combined launcher smoke:
  - `PORT=3103 AUTO_RUN_CLAUDE=false ./start.sh`
  - backend became healthy, TUI showed `ONLINE`
  - sent `Ctrl+\`` sequence and `q`
  - script stopped the backend it started
  - `lsof -nP -iTCP:3103 -sTCP:LISTEN || true`
- Web frontend smoke after user clarification:
  - copied complete legacy `frontend/` runtime from `/Users/wow/wrk/codeworks/claude-punk/frontend`, excluding `node_modules` and `dist`
  - replaced Phaser first screen with Bauhaus/cmux DOM workbench in `frontend/src/main.js`
  - `npm --workspace frontend run build`
  - `NO_OPEN=1 PORT=3105 FRONTEND_PORT=5175 AUTO_RUN_CLAUDE=false ./start.sh`
  - `curl -s http://127.0.0.1:5175`
  - `curl -s http://127.0.0.1:3105/health`
  - stopped script and confirmed no listeners on ports `3105` or `5175`

Results:

- CLI unit tests passed: 10/10.
- Backend health/list/create/kill smoke passed after fixing `node-pty` spawn-helper permissions for hoisted workspace installs.
- TUI offline/reconnect/command-mode exit smoke passed.
- Combined `start.sh` backend-plus-TUI smoke passed.
- Web workbench build and start smoke passed. Vite reported large Monaco chunks and a non-blocking dynamic/static import warning for `retroTvPlayer.js`.

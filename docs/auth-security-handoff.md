# Auth And Path Safety Handoff

Date: 2026-05-04

This handoff is for the next implementation pass after context cleanup. The goal is to add backend auth, role checks, token management, audit logging, and canonical path validation without changing the existing REST/WebSocket protocol success shapes.

## Implementation Update

Status: implemented in `backend/server.js` with focused regression coverage in `backend/test/auth-security.test.js`.

Implemented:

- `GET /health` remains unauthenticated.
- `/api/*` requires auth and role checks. CLI/native clients use `Authorization: Bearer <token>`; browser clients may use a signed `HttpOnly` browser session cookie.
- `/ws` rejects missing/invalid auth during upgrade with HTTP `401`.
- Browser WebSocket auth uses a signed `HttpOnly` cookie created by `POST /api/auth/browser-session`; `?token=...` remains only a localhost development fallback.
- Tokens are stored as scrypt hashes in `~/.claude-punk/auth.json`; plaintext tokens are only returned/printed at creation time.
- Dev/project deployments may set `CLAUDE_PUNK_ADMIN_TOKEN` or `CLAUDE_PUNK_AUTH_KEY` in project `.env`. The backend hot-reloads that token on validation without writing plaintext to `~/.claude-punk/auth.json`.
- `CLAUDE_PUNK_AUTH_DIR` can move backend auth state, including browser-session signing secret and audit log, out of `~/.claude-punk`.
- Browser session cookies are signed with a private server secret stored in the backend auth state file and remain tied to a non-revoked token id.
- Initial admin token is created and printed once when the token store is empty.
- Token management routes exist:
  - `GET /api/auth/whoami`
  - `POST /api/auth/browser-session`
  - `DELETE /api/auth/browser-session`
  - `POST /api/tokens`
  - `GET /api/tokens`
  - `DELETE /api/tokens/:id`
- Audit logging writes sensitive operation metadata to `~/.claude-punk/audit.log` without token plaintext or file content.
- File operations use canonical `realpath` plus `path.relative` validation and reject traversal, prefix sibling paths, root delete, and symlink escapes.
- CLI client auth already uses `Authorization: Bearer <token>`.
- Browser workbench shows an in-page auth panel when no token is configured. It stores a local token under `claude-punk-token`, exchanges it for the browser session cookie, and opens WebSocket without placing the token in the URL.

Verification:

- `npm --workspace backend test`
- `npm --workspace cli test`
- `npm --workspace frontend run build`

## Current State

- `backend/server.js` is still the backend source of truth.
- `GET /health` is unauthenticated and should stay that way.
- `/api/*` is authenticated.
- `/ws` is authenticated.
- File operations in `backend/server.js` use canonical path validation.
- CLI is token-ready:
  - `cli/src/api.js` sends `Authorization: Bearer <token>` when configured.
  - `cli/src/wsClient.js` sends `Authorization: Bearer <token>` during WebSocket connection.
  - `cli/src/config.js` reads `~/.claude-punk/client.json` and `CLAUDE_PUNK_TOKEN`.
  - `cli/src/index.js` already exposes `login`, `logout`, `whoami`, `token create`, `token list`, and `token revoke` command surfaces.
- Browser frontend stores a local token through the visible Auth panel, exchanges it for a signed `HttpOnly` browser session cookie, and uses that cookie for REST/WebSocket browser traffic. Query-token WebSocket auth is still available only for localhost fallback.

## Project Env Auth

For local development or single-tenant deployments, use project `.env`:

```dotenv
CLAUDE_PUNK_ADMIN_TOKEN=change-this-local-secret
CLAUDE_PUNK_AUTH_DIR=.cli-punk-auth
```

- `CLAUDE_PUNK_ADMIN_TOKEN` is treated as an admin bearer token.
- `CLAUDE_PUNK_AUTH_KEY` and `CLAUDE_PUNK_DEV_TOKEN` are accepted aliases.
- Updating the token in `.env` takes effect on the next auth check. Existing browser cookies tied to the old env token become invalid because env-token ids are derived from the token digest.
- `.env` and `.cli-punk-auth/` are ignored by git.
- If no env token and no stored token exist, backend still creates a one-time initial admin token.

## Production Domain Notes

- Recommended deployment: serve frontend and backend under the same HTTPS origin, or reverse-proxy `/api` and `/ws` to the backend. No URL token is used in this mode.
- If the frontend and backend are on different origins, set `CLAUDE_PUNK_ALLOWED_ORIGINS` to a comma-separated list such as `https://cli.example.com`.
- For different-site frontend/backend deployments, use HTTPS and set `CLAUDE_PUNK_COOKIE_SAMESITE=None` so the browser may send the session cookie cross-site. Same-origin or same-site deployments should keep the default `Lax`.
- WebSocket upgrade checks the browser `Origin` header when present. Same-origin, localhost, and `CLAUDE_PUNK_ALLOWED_ORIGINS` are accepted.
- `?token=...` is intentionally not a production transport because URLs are commonly captured in browser history, access logs, proxy logs, referer headers, screenshots, and shared links.

## Source References

- Spec: `CLI_REDEVELOPMENT_FUNCTIONAL_SPEC.md`
  - Path validation: lines around section `6.5`
  - Auth model: section `7.2`
  - Roles: section `7.4`
  - CLI auth commands: section `7.5`
  - Auth errors: section `7.6`
  - Security requirements: section `7.7`
- Backend ingress:
  - WebSocket server: `backend/server.js` around `createWSS(...)`
  - REST router: `backend/server.js` around `createRESTRouter(...)`
  - Health route: `backend/server.js` `GET /health`
- Sensitive WebSocket handlers:
  - `session.create`
  - `session.prompt`
  - `terminal.input`
  - `terminal.resize`
  - `session.kill`
  - `fs.browse`
  - `files.requestTree`
  - `file.read`
  - `file.write`
  - `file.create`
  - `file.delete`
  - `file.upload`
  - `file.download`
  - `claude.requestConfig`
  - `claude.listConversations`
  - `claude.watchActivity`
  - `claude.unwatchActivity`
- Sensitive REST routes:
  - `POST /api/sessions`
  - `GET /api/sessions`
  - `GET /api/sessions/:id`
  - `DELETE /api/sessions/:id`

## Protocol Rules

- Preserve WebSocket envelope:

```json
{ "type": "event.name", "payload": {}, "timestamp": "ISO timestamp" }
```

- Preserve existing successful event names and payload shapes.
- Add auth as ingress gating, not by renaming messages.
- REST auth failures:
  - Missing token: `401 { "error": "AUTH_REQUIRED" }`
  - Invalid token: `401 { "error": "AUTH_INVALID" }`
  - Insufficient role: `403 { "error": "AUTH_FORBIDDEN" }`
- WebSocket auth failures:
  - Prefer rejecting upgrade with HTTP `401`.
  - If reject-on-upgrade is hard with the current `ws` wiring, immediately send `error` and close.
- Do not put tokens in WebSocket `error` payloads.

## Role Matrix

| Operation | Admin | Operator | Viewer |
|---|---:|---:|---:|
| `GET /health` | yes | yes | yes |
| `GET /api/sessions` | yes | yes | yes |
| `GET /api/sessions/:id` | yes | yes | yes |
| `POST /api/sessions` | yes | yes | no |
| `DELETE /api/sessions/:id` | yes | yes | no |
| `session.create` | yes | yes | no |
| `session.prompt` | yes | yes | no |
| `terminal.input` | yes | yes | no |
| `terminal.resize` | yes | yes | no |
| `session.kill` | yes | yes | no |
| `fs.browse` | yes | yes | yes |
| `files.requestTree` | yes | yes | yes |
| `file.read` | yes | yes | yes |
| `file.write` | yes | yes | no |
| `file.create` | yes | yes | no |
| `file.delete` | yes | yes | no |
| `file.upload` | yes | yes | no |
| `file.download` | yes | yes | yes |
| `claude.requestConfig` | yes | yes | yes |
| `claude.listConversations` | yes | yes | yes |
| `claude.watchActivity` | yes | yes | yes |
| `claude.unwatchActivity` | yes | yes | yes |
| `token create/list/revoke` | yes | no | no |

## Implementation Sequence

1. Add test fixture and auth/path regression tests first.
2. Add token store helpers inside `backend/server.js` or a minimal `backend/src/auth` module only if tests can import it cleanly.
3. Add startup token bootstrap:
   - Token store path: `~/.claude-punk/auth.json` by default, or `CLAUDE_PUNK_AUTH_DIR/auth.json`
   - Store only hashes, never plaintext.
   - If no tokens exist, create an initial admin token and print it once.
   - Plain token must not be written to disk.
4. Add bearer parsing and project env token support:
   - HTTP header: `Authorization: Bearer <token>`
   - WebSocket upgrade header.
   - Query token fallback only for localhost development if implemented.
   - Project `.env` keys: `CLAUDE_PUNK_ADMIN_TOKEN`, `CLAUDE_PUNK_AUTH_KEY`, `CLAUDE_PUNK_DEV_TOKEN`.
5. Add role-aware REST middleware for `/api/*`.
6. Add WebSocket auth gating before `connection` message handling.
7. Add token management routes:
   - `GET /api/auth/whoami`
   - `POST /api/tokens`
   - `GET /api/tokens`
   - `DELETE /api/tokens/:id`
8. Add audit logging:
   - Token create/revoke
   - Session create/kill
   - File write/upload/delete/download
   - Log token id, role, operation, target path/session id, timestamp
   - Do not log plaintext token or file content.
9. Replace all file target resolution checks with canonical path validation.
10. Update browser frontend auth token source.
11. Run security and compatibility tests.

## Token Store Shape

Use the spec shape:

```json
{
  "version": 1,
  "browserSessionSecret": "server-private-random-secret",
  "tokens": [
    {
      "id": "tok_xxx",
      "name": "main-cli",
      "hash": "scrypt-hash",
      "role": "admin",
      "createdAt": "ISO timestamp",
      "lastUsedAt": "ISO timestamp or null",
      "revokedAt": null
    }
  ]
}
```

Recommended Node primitive: `crypto.scrypt` plus `crypto.timingSafeEqual`.

Hash string can be encoded as:

```text
scrypt$N$r$p$saltBase64$keyBase64
```

or a simpler documented format if tests cover verify behavior.

## Browser Frontend Auth

The browser frontend now has a visible auth panel and token entry flow:

- The user enters an admin/operator/viewer token in the page.
- The browser stores the token locally under `claude-punk-token`.
- Before WebSocket connect, `frontend/src/services/websocket.js` calls `POST /api/auth/browser-session` with `Authorization: Bearer <token>` and `credentials: include`.
- The backend sets a signed `HttpOnly` cookie; WebSocket then connects to `/ws` without a token in the URL.
- Localhost-only query-token fallback remains for development compatibility when the browser session endpoint is unavailable.

## Canonical Path Validation

Required helper semantics:

```js
async function resolveInside(rootDir, targetPath) {
  const root = await fs.promises.realpath(rootDir);
  const resolved = path.resolve(root, targetPath);
  const parent = await fs.promises.realpath(path.dirname(resolved));
  const finalPath = path.join(parent, path.basename(resolved));
  const relative = path.relative(root, finalPath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('PATH_OUTSIDE_WORKDIR');
  return finalPath;
}
```

Notes:

- Existing files can use `realpath(target)`.
- New files need parent canonicalization because the target may not exist yet.
- Reject deleting the resolved session root.
- Do not use `target.startsWith(workDir)`.
- Decide how to handle symlinks explicitly; default should reject symlink escape.

## Tests To Add

Backend auth:

- `GET /health` works without token.
- `GET /api/sessions` missing token -> `401 AUTH_REQUIRED`.
- Invalid token -> `401 AUTH_INVALID`.
- Revoked token -> `401 AUTH_INVALID`.
- Viewer token denied for session create/kill and file writes -> `403 AUTH_FORBIDDEN`.
- Operator token denied for token create/revoke -> `403 AUTH_FORBIDDEN`.
- Admin token can create/list/revoke tokens.

WebSocket auth:

- Missing token cannot use `/ws`.
- Invalid token cannot use `/ws`.
- Viewer token can receive replay/list/read events but cannot send `terminal.input`, `session.kill`, `file.write`, `file.upload`, `file.delete`.
- Existing success payloads remain unchanged for authorized clients.

Path safety:

- `../outside.txt` rejected.
- Absolute path outside workDir rejected.
- Prefix sibling path rejected, e.g. `workDir=/tmp/repo`, target `/tmp/repo-other/file`.
- Root delete rejected.
- Upload/create parent traversal rejected.
- Symlink escape rejected or explicitly tested to chosen policy.

Audit:

- Token create/revoke writes audit event without plaintext token.
- Session create/kill writes audit event.
- File write/upload/delete/download writes audit event without file content.

Compatibility:

- Authorized `session.create` still emits `session.update` with unchanged public session object.
- Authorized `terminal.output` and `terminal.replay` payloads unchanged.
- Authorized `file.content`, `file.saved`, `file.uploaded`, `file.downloadReady`, `file.deleted` payloads unchanged.

## Known Blockers / Decisions

- Backend is still a large single file. Do not do broad modularization unless compatibility tests are in place.
- Full release status still needs the broader release-gate checklist and manual browser smoke on the target deployment shape.

## Suggested Next Prompt After Context Cleanup

```text
Continue auth hardening from docs/auth-security-handoff.md.
Implement backend token store, REST/WS bearer auth, role checks, audit logging, canonical path validation, and focused regression tests.
Preserve existing REST/WebSocket success payload shapes.
Start by adding tests around current backend/server.js behavior, then patch backend/server.js minimally.
```

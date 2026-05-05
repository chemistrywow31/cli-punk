# Findings

- Backend now requires bearer auth for `/api/*` and `/ws`; `/health` remains unauthenticated.
- Backend creates an initial admin token when `~/.claude-punk/auth.json` has no tokens and stores only scrypt hashes.
- Browser WebSocket now uses `POST /api/auth/browser-session` to exchange the page-entered token for a signed `HttpOnly` cookie, then opens `/ws` without a URL token.
- Query-token WebSocket auth remains only as a localhost development fallback; backend rejects it unless the server bind, request host, and remote address are localhost.
- Production browser deployments should use same-origin HTTPS or configure `CLAUDE_PUNK_ALLOWED_ORIGINS`; different-site deployments can opt into `CLAUDE_PUNK_COOKIE_SAMESITE=None` over HTTPS.
- File operations now use canonical path checks and reject traversal, absolute outside paths, prefix sibling paths, and symlink escapes.
- Audit logging writes token/session/file operation metadata to `~/.claude-punk/audit.log` without token plaintext or file content.
- Workbench runtime no longer imports Audio/Jukebox/Retro TV/Volume controls, and Display no longer exposes background selection.
- File preview/editor zoom is explicit and visible via `Ctrl+-`, `Ctrl+0`, and `Ctrl+=`, with scrollable preview overflow instead of size-clamped rendering.

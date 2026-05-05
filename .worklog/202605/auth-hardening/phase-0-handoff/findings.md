# Findings

- Backend auth is not implemented.
- `GET /health` is the only route that should remain unauthenticated.
- REST `/api/*` and WebSocket `/ws` currently allow sensitive operations without bearer auth.
- CLI already has token-ready request paths and command surfaces, but backend routes are missing.
- Browser WebSocket auth needs a transport decision because browser `WebSocket` cannot set custom `Authorization` headers.
- File operations still need canonical path validation. Prefix checks must be replaced before claiming path safety.
- The next auth phase must preserve existing protocol success payloads and add auth only at ingress/permission boundaries.

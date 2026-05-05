# Decisions

- Preserve existing successful REST and WebSocket payload shapes; auth failures are added at ingress and role boundaries.
- Use a signed `HttpOnly` browser session cookie for browser REST/WebSocket auth because browser WebSocket cannot set `Authorization` headers directly.
- Keep `?token=...` only as a localhost development fallback, never as the production browser transport.
- Keep legacy compatibility `drinkCount` in backend protocol but remove drink/music wording from visible CLI/workbench UI.
- Use focused integration tests with a temporary `HOME` and random local port so auth tests do not touch the user's real token store.
- Do not start the real backend during validation because doing so can create a real initial admin token in `~/.claude-punk/auth.json`.

# References

- `docs/auth-security-handoff.md`
- `CLI_REDEVELOPMENT_FUNCTIONAL_SPEC.md`
- `backend/server.js`
- `cli/src/api.js`
- `cli/src/wsClient.js`
- `cli/src/config.js`
- `cli/src/index.js`
- `frontend/src/services/websocket.js`
- `.agents/skills/security-hardening/SKILL.md`
- `.agents/skills/protocol-contract/SKILL.md`
- `.codex/rules/security-and-path-safety.md`
- `.codex/rules/backend-protocol-freeze.md`

Commands:

- `rg -n "createWSS|createRESTRouter|file\\.read|file\\.write|file\\.upload|file\\.download|file\\.create|file\\.delete|terminal\\.input|session\\.create|session\\.kill|app.use\\('/api'|app.get\\('/health'" backend/server.js`
- `rg -n "login|whoami|token create|token list|token revoke|Authorization|Bearer|client.json|CLAUDE_PUNK_TOKEN" cli/src frontend/src -S`
- `rg -n "身份驗證|Auth Model|Roles|Path validation|CLI Auth|Auth Errors|Security Requirements" CLI_REDEVELOPMENT_FUNCTIONAL_SPEC.md`

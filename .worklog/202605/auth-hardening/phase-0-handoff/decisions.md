# Decisions

- Create `docs/auth-security-handoff.md` before context cleanup so the next pass can start from a precise implementation checklist.
- Do not implement auth in this phase; only document the contract, role matrix, sequence, test checklist, and unresolved browser WebSocket decision.
- Keep backend modularization out of scope for the first auth pass unless tests make extraction safe.
- Treat browser WebSocket auth transport as the main decision required before enforcing auth for web users.

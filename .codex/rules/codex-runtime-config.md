---
name: Codex Runtime Config
description: Keep the project-local Codex multi-agent runtime self-contained and path-correct.
---

# Codex Runtime Config

## Applicability

Use this rule when editing `AGENTS.md`, `.codex/config.toml`, `agents/**/*.toml`, `.codex/rules/`, `.codex/skills/`, or `.agents/skills/`.

## Rule

- Treat `.codex/config.toml` as the project-local runtime switch.
- Keep runtime agent TOML files under project-root `agents/`.
- Resolve `config_file` paths relative to `.codex/`; use `../agents/...`.
- Keep runtime-discoverable skills under `.agents/skills/`.
- Keep authored skill mirrors under `.codex/skills/`.
- Do not put generated runtime agent configs under `.codex/agents/`.
- Do not require changes to `~/.codex/config.toml`.

## Violation Determination

This rule is violated when an agent config path does not resolve from `.codex/`, when runtime TOML files are placed under `.codex/agents/`, or when project setup depends on a user-global Codex config.

## Repair

Move runtime TOML files to `agents/`, update `.codex/config.toml` paths to `../agents/...`, and verify every registered path resolves.

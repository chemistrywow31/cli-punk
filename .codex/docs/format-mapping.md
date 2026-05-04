# Format Mapping

## Requested Format

The user explicitly requested direct generation into `/Users/wow/wrk/side_proj/cli-punk` instead of an A-Team package under `teams/`.

## Canonical Format

Codex-native project-local runtime is canonical:

- `AGENTS.md`
- `.codex/config.toml`
- `agents/**/*.toml`
- `.codex/rules/*.md`
- `.codex/skills/*/SKILL.md`
- `.agents/skills/*/SKILL.md`

## Codex To Claude Mapping

| Codex artifact | Future Claude-compatible target | Notes |
| --- | --- | --- |
| `AGENTS.md` | `CLAUDE.md` or project instructions | Requires adapting Codex delegation terms. |
| `.codex/config.toml` | Claude runtime settings | No direct 1:1 mapping for Codex agent registry. |
| `agents/**/*.toml` | `.claude/agents/*.md` | TOML runtime fields must be transformed into Markdown frontmatter and body. |
| `.codex/rules/*.md` | `.claude/rules/*.md` or included docs | Rule semantics are portable. |
| `.agents/skills/*/SKILL.md` | `.claude/skills/*/SKILL.md` | Skill bodies are mostly portable after removing Codex-only runtime terms. |
| `.codex/docs/format-mapping.md` | mapping sidecar | Keep as conversion evidence. |

## Lossy Cases

- Codex `config_file` registry paths have no direct Claude-native equivalent.
- Codex multi-agent runtime registration does not map cleanly to Claude-only agent invocation settings.
- Claude-only concepts such as `allowed-tools`, `disable-model-invocation`, hooks, and `context: fork` are intentionally not generated here.

## Round-Trip Notes

Codex remains canonical for this project. If Claude-compatible output is needed later, convert from the Codex artifacts and preserve this mapping file plus `.codex/docs/format-mapping.manifest.yaml` as sidecar evidence.

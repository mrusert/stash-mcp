# @agentstash/mcp

Shared memory for **Claude Code**, **Cursor**, **OpenCode**, and **Codex**. Progress and decisions persist across sessions and tools.

## Install

```bash
# Claude Code (MCP + skill + full hooks) — default with Cursor
npx @agentstash/mcp init --api-key sk_... --claude --force

# OpenCode (MCP + continuity plugin)
npx @agentstash/mcp init --api-key sk_... --opencode --force

# Codex (MCP + AGENTS.md continuity notes)
npx @agentstash/mcp init --api-key sk_... --codex --force

# Everything
npx @agentstash/mcp init --api-key sk_... --all --force
```

Or register a free key: `--register --agent-name my-laptop`

Restart the tool after install. Check: `npx @agentstash/mcp doctor`

## What you get per harness

| Harness | MCP tools | Auto continuity |
|---------|-----------|-----------------|
| Claude Code | Yes | SessionStart inject, PreCompact/SessionEnd checkpoint, git-commit log |
| OpenCode | Yes | Plugin hooks → same CLI (`session-start`, `checkpoint`, `log-commit`) |
| Codex | Yes | Soft: `~/.codex/AGENTS.md` tells the model to resume/save |
| Cursor | Yes | Soft: tools only |

## Continuity model

```text
Agent (MCP tools)  → rich save_progress / remember
Hooks / plugins    → guaranteed checkpoints (Claude, OpenCode)
AGENTS.md          → soft guidance (Codex)
```

CLI (any harness):

| Command | Role |
|---------|------|
| `session-start` | Prior progress brief |
| `checkpoint pre_compact\|session_end` | Merge-save progress |
| `log-commit` | Log git commit events |

## Config locations

| Tool | Where |
|------|--------|
| Claude | `~/.claude/settings.json` + hooks + skill |
| Cursor | `~/.cursor/mcp.json` |
| OpenCode | `~/.config/opencode/opencode.json` + `plugins/agent-stash.js` |
| Codex | `~/.codex/config.toml` + `AGENTS.md` |
| Key store | `~/.agentstash/config.json` |

## MCP tools

`remember` / `recall` · `save_progress` / `resume_progress` · `log_event` / `read_log` · `list_memories` / `find_memory` / `forget`

## Development

```bash
npm test
node src/cli.js help
```

See [ROADMAP.md](./ROADMAP.md).

## License

MIT

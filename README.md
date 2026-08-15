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

Or register a free key: `--register --claude`

Restart the tool after install. Check: `npx @agentstash/mcp doctor`

## What you get per harness

| Harness | MCP tools | Auto continuity |
|---------|-----------|-----------------|
| Claude Code | Yes | SessionStart inject, PreCompact/SessionEnd checkpoint, git-commit log, **StopFailure → handoff** |
| OpenCode | Yes | Plugin hooks → same CLI (`session-start`, `checkpoint`, `log-commit`) |
| Codex | Yes | Soft: `~/.codex/AGENTS.md` tells the model to resume/save |
| Cursor | Yes | Soft: tools only |

## Continuity model

```text
Agent (MCP tools)  → rich save_progress / remember
Hooks / plugins    → guaranteed checkpoints (Claude, OpenCode)
StopFailure        → auto handoff on rate_limit / API errors (Claude)
AGENTS.md          → soft guidance (Codex)
```

CLI (any harness):

| Command | Role |
|---------|------|
| `session-start` | Prior progress brief |
| `checkpoint pre_compact\|session_end` | Merge-save progress |
| `log-commit` | Log git commit events |
| `handoff` | Freeze progress + resume card (provider limits) |

### Handoff (provider limits)

When Claude hits a usage/rate limit, the model often cannot call tools. Two paths:

1. **Auto (Claude Code):** `StopFailure` hook runs `handoff` after reinstall with `init --claude --force`
2. **Manual (any tool):**

```bash
npx @agentstash/mcp handoff
npx @agentstash/mcp handoff -m "mid auth refactor" --to opencode
```

This merge-saves `{project}-progress`, logs a `handoff` event, and prints how to resume in Claude / OpenCode / Codex / Cursor.

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

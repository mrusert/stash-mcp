# @agentstash/mcp

Shared memory for Claude Code, Cursor, Codex, and (soon) OpenCode. Decisions and progress persist across sessions and tools.

## Install (one command)

```bash
npx @agentstash/mcp init --api-key sk_your_key_here --claude --force
# or register a free key:
npx @agentstash/mcp init --register --agent-name my-laptop --claude
```

**Restart Claude Code** after init.

```bash
npx @agentstash/mcp doctor
```

## What `init` installs (Claude Code)

| Piece | Purpose |
|-------|---------|
| MCP server | Tools: `remember`, `save_progress`, `resume_progress`, … |
| Continuity skill | Soft guidance for mid-session saves |
| **SessionStart** hook | Inject prior `{project}-progress` into context |
| **PreCompact** hook | Merge-save progress before context compaction |
| **SessionEnd** hook | Merge-save progress on clean exit |
| **PostToolUse** (Bash) | If command is `git commit`, append a log event |

Hooks call the **HTTP API** via CLI (`session-start`, `checkpoint`, `log-commit`). They never call MCP tools directly.

Skip hooks: `--no-hooks`. Replace: `--force`.

## Continuity model

```text
Agent (skill/MCP)  → rich save_progress / remember   (judgment)
Hooks              → guaranteed checkpoints + commit log
Crash / kill -9    → no hook; prior checkpoints bound the loss
```

OpenCode & Codex adapters: see [ROADMAP.md](./ROADMAP.md). CLI actions are harness-agnostic.

## CLI commands

| Command | Role |
|---------|------|
| `init` | Install MCP + skill + hooks |
| `doctor` | Health check |
| `uninstall` | Remove MCP + skill + hooks |
| `session-start` | Print progress brief (SessionStart) |
| `checkpoint <reason>` | Merge-save progress (`pre_compact`, `session_end`, …) |
| `log-commit` | Log git commit if stdin/tool payload matches |

## Manual MCP config

```json
{
  "mcpServers": {
    "agent-stash": {
      "command": "npx",
      "args": ["-y", "@agentstash/mcp"],
      "env": { "AGENT_STASH_API_KEY": "sk_..." }
    }
  }
}
```

## Tools

| Tool | When to use |
|------|-------------|
| `remember` / `recall` | Long-lived decisions |
| `save_progress` / `resume_progress` | Task snapshot (rich, agent-written) |
| `log_event` / `read_log` | Audit trail |
| `list_memories` / `find_memory` / `forget` | Key management |

## Environment

| Variable | Description |
|----------|-------------|
| `AGENT_STASH_API_KEY` | Required for MCP server |
| `AGENT_STASH_PROJECT` | Override project slug |
| `AGENT_STASH_URL` | Default `https://agentstash.ai` |

## Development

```bash
npm test
node src/cli.js help
```

## License

MIT

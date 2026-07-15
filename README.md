# @agentstash/mcp

Shared memory for Claude Code, Cursor, and Codex. Decisions, progress, and context persist across sessions, machines, and tool switches.

## Install (one command)

```bash
# Register a free key and configure Claude Code + Cursor
npx @agentstash/mcp init --register --agent-name my-laptop

# Or use an existing key from https://agentstash.ai
npx @agentstash/mcp init --api-key sk_your_key_here
```

Then **restart** Claude Code / Cursor so MCP reloads.

Check setup:

```bash
npx @agentstash/mcp doctor
```

Remove:

```bash
npx @agentstash/mcp uninstall
```

### What `init` does

1. Obtains or saves your API key (`~/.agentstash/config.json`, mode `0600`)
2. Adds the Agent Stash MCP server to Claude Code (via `claude mcp add` when available, otherwise `~/.claude/settings.json`) and/or Cursor (`~/.cursor/mcp.json`)
3. Installs a small Claude continuity skill (`~/.claude/skills/agent-stash/`) so agents are guided to `resume_progress` / `save_progress`

Flags: `--claude`, `--cursor`, `--all`, `--force`, `--no-skill`, `--api-url`, `--project`.

### Manual config (if you prefer)

#### Claude Code

```json
{
  "mcpServers": {
    "agent-stash": {
      "command": "npx",
      "args": ["-y", "@agentstash/mcp"],
      "env": {
        "AGENT_STASH_API_KEY": "sk_your_key_here"
      }
    }
  }
}
```

Or: `claude mcp add -s user agent-stash -e AGENT_STASH_API_KEY=sk_... -- npx -y @agentstash/mcp`

#### Cursor

Add the same `mcpServers` block to `~/.cursor/mcp.json`.

Memory is scoped to your current git project automatically (detected from `git remote.origin.url`). Override with `AGENT_STASH_PROJECT` if needed.

## Tools

| Tool | When to use |
|------|-------------|
| `remember(key, value)` | After a meaningful decision or architectural choice |
| `recall(key)` | At session start to load prior context |
| `list_memories(prefix?)` | To discover what's stored in this project |
| `forget(key)` | To remove a stale memory |
| `save_progress(task, completed_steps, next_step, decisions, files_touched)` | Before risky work or when context is filling up |
| `resume_progress()` | At session start when continuing prior work |
| `log_event(event, details?)` | To record significant actions for the audit trail |
| `read_log(limit?)` | To see what happened in prior sessions |
| `find_memory(query)` | To search memories by key name |

## Environment variables

| Variable | Required | Description |
|----------|----------|-------------|
| `AGENT_STASH_API_KEY` | Yes (for MCP server) | API key from agentstash.ai |
| `AGENT_STASH_PROJECT` | No | Override project namespace (default: git repo name) |
| `AGENT_STASH_URL` | No | Override API URL (default: https://agentstash.ai) |

## CLI vs MCP server

| Command | Role |
|---------|------|
| `npx @agentstash/mcp` (no args) | Starts the **MCP server** (stdio) — what Claude/Cursor launch |
| `npx @agentstash/mcp init \| doctor \| uninstall` | **Install CLI** for humans |
| `agentstash …` | Same CLI (if package bins are on PATH) |

## Development

```bash
npm test
node src/cli.js help
```

## License

MIT

# @agentstash/mcp

Shared memory for Claude Code, Cursor, and Codex. Decisions, progress, and context persist across sessions, machines, and tool switches.

## Setup

**1. Get an API key** at [agentstash.ai](https://agentstash.ai) (free tier available), or register headlessly:

```bash
curl -X POST https://agentstash.ai/register/agent \
  -H 'Content-Type: application/json' \
  -d '{"agent_name": "my-project"}'
```

**2. Add to your tool's MCP config.**

### Claude Code

Add to `~/.claude/settings.json`:

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

### Cursor

Add to `~/.cursor/mcp.json`:

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
| `AGENT_STASH_API_KEY` | Yes | API key from agentstash.ai |
| `AGENT_STASH_PROJECT` | No | Override project namespace (default: git repo name) |
| `AGENT_STASH_URL` | No | Override API URL (default: https://agentstash.ai) |

## License

MIT

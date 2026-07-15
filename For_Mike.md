# stash-mcp — For Mike

## What this package is

The npm package `@agentstash/mcp` is how coding agents talk to Agent Stash without raw HTTP.

It has **two entrypoints**:

1. **MCP server** (`npx @agentstash/mcp` with no args) — stdio tools Claude/Cursor launch  
2. **Install CLI** (`npx @agentstash/mcp init|doctor|uninstall`) — one-shot setup for humans  

## Why the CLI exists

Users should not hand-edit `~/.claude/settings.json` or invent continuity habits.  
`init` writes MCP config + a thin Claude skill. Hard SessionStart/Stop **hooks** are still a later plugin — this ships the install path and soft continuity guidance.

## Mapping MCP tools → API

| MCP tool | API |
|----------|-----|
| `remember(key, value)` | `PUT /memory/{project}-{key}?persistent=true` |
| `save_progress(...)` | `PUT /memory/{project}-progress?persistent=true` (fixed JSON) |
| `resume_progress()` | `GET /memory/{project}-progress?persistent=true` |

Project slug = git remote repo name (or cwd / `AGENT_STASH_PROJECT`).

## CLI files

| Path | Role |
|------|------|
| `src/bin.js` | Routes CLI commands vs MCP server |
| `src/cli.js` | CLI main |
| `src/cli/init.js` | `init` |
| `src/cli/doctor.js` | `doctor` |
| `src/cli/targets/claude.js` | `claude mcp add` + settings.json + skill |
| `src/cli/targets/cursor.js` | `~/.cursor/mcp.json` |
| `src/cli/skill-template.md` | Continuity skill body |

User key store: `~/.agentstash/config.json` (0600).

## Publish

This is **not** Railway. After merge to main:

```bash
cd stash-mcp && npm publish --access public
```

Until published, local:

```bash
node src/cli.js init --api-key sk_... --claude
```

## Tests

```bash
npm test   # node:test unit tests, no network
```

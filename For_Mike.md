# stash-mcp — For Mike

## What this package is

The npm package `@agentstash/mcp` is how coding agents talk to Agent Stash without raw HTTP.

It has **two entrypoints**:

1. **MCP server** (`npx @agentstash/mcp` with no args) — stdio tools Claude/Cursor launch  
2. **Install CLI** (`npx @agentstash/mcp init|doctor|uninstall`) — one-shot setup for humans  

## Why the CLI exists

Users should not hand-edit `~/.claude/settings.json` or invent continuity habits.  
`init` writes MCP config + skill + **Claude continuity hooks**:

- SessionStart → inject progress brief  
- PreCompact / SessionEnd → merge-save checkpoint (preserves agent fields)  
- PostToolUse(Bash) → log git commits  

Mid-session rich `save_progress` stays skill/judgment-based.  
OpenCode/Codex: same CLI actions later; see `ROADMAP.md`.

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
| `src/cli/session-brief.js` | Fetch + format progress brief |
| `src/cli/checkpoint.js` | Merge-save progress |
| `src/cli/log-commit.js` | Detect/log git commits |
| `src/cli/hooks.js` | Install all Claude Code continuity hooks |
| `src/cli/run-*.js` | CLI entry for session-start / checkpoint / log-commit |
| `ROADMAP.md` | OpenCode + Codex adapter plan |

User key store: `~/.agentstash/config.json` (0600).  
Hook runner: `~/.agentstash/bin/hook-runner.mjs` →  
`npx --package=@agentstash/mcp agentstash <cmd>` with **cwd=`~/.agentstash`**  
(so working inside the `stash-mcp` repo does not shadow the published package).

Commit detection strips quotes/comments and only treats `git … commit` as a real subcommand  
(avoids logging when Bash merely echoes the words “git commit”).

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

# Agent Stash MCP / Continuity Roadmap

## Done (Claude Code)

| Capability | Mechanism |
|------------|-----------|
| MCP tools | `@agentstash/mcp` stdio server |
| Install CLI | `init`, `doctor`, `uninstall` |
| Auto-resume | `SessionStart` → inject progress brief |
| Pre-compact save | `PreCompact` → merge checkpoint |
| Session end save | `SessionEnd` → merge checkpoint |
| Commit audit | `PostToolUse` + Bash matcher → `log_event` style log entry |

Shared idea: **hooks are HTTP/CLI checkpoints**; **MCP tools are judgment-quality writes**.

## Planned: OpenCode

OpenCode has MCP + a **plugin/hooks** system (session lifecycle).

| Port | Approach |
|------|----------|
| MCP | Same package / same tools (already works if MCP configured) |
| Session start brief | OpenCode plugin hook → `npx @agentstash/mcp session-start` |
| Checkpoint on compact/end | Map OpenCode equivalents to `checkpoint pre_compact` / `session_end` |
| Commit log | Plugin tool-end hook filtered on `git commit` → `log-commit` |
| Install | `agentstash init --opencode` writes OpenCode config + plugin stub |

**Not started.** Track as `feature/opencode-hooks` when design partners use OpenCode daily.

## Planned: Codex (OpenAI)

Codex supports MCP; lifecycle hooks are less standardized than Claude Code.

| Port | Approach |
|------|----------|
| MCP | Same `npx @agentstash/mcp` server block in Codex MCP config |
| Continuity | Prefer MCP tools + project `AGENTS.md` instructions until Codex exposes SessionStart-like hooks |
| When hooks exist | Reuse CLI commands (`session-start`, `checkpoint`, `log-commit`) unchanged |
| Install | `agentstash init --codex` writes Codex MCP config |

**Not started.** CLI commands are **harness-agnostic** so Codex only needs a thin config adapter.

## Non-goals (near term)

- Stop hook every turn (too noisy)
- Catching kill -9 / crash (impossible in-process)
- Local↔cloud sync product
- Replacing agent `save_progress` judgment with only hooks

## Design rule for every new harness

1. Implement actions as **CLI/HTTP** (`session-start`, `checkpoint`, `log-commit`)  
2. Add a **thin install target** that wires that harness’s lifecycle to those commands  
3. Keep progress JSON shape and project slug rules identical  

That way Claude Code, OpenCode, and Codex share one continuity brain.

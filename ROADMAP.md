# Agent Stash MCP / Continuity Roadmap

## Done

| Harness | MCP | Auto continuity |
|---------|-----|-----------------|
| **Claude Code** | `init --claude` | SessionStart, PreCompact, SessionEnd, PostToolUse(git commit), **StopFailure → handoff** |
| **Cursor** | `init --cursor` | Soft (tools only) |
| **OpenCode** | `init --opencode` | Plugin: session.created / compacting / tool.execute.after / session.deleted |
| **Codex** | `init --codex` | Soft: AGENTS.md + MCP tools |

Shared CLI brain (all harnesses):

- `session-start` — inject/print progress brief  
- `checkpoint <reason>` — merge-save progress  
- `log-commit` — audit git commits  
- `handoff` — freeze progress + resume card; Claude StopFailure auto-triggers  

## Design rule

1. Actions live in **CLI/HTTP** (harness-agnostic)  
2. Each harness gets a **thin install adapter** only  
3. Progress JSON + project slug rules stay identical  

## Done recently (0.6.0)

| Item | Notes |
|------|--------|
| `agentstash handoff` | Checkpoint reason `handoff`, optional `-m` / `--to`, project log event |
| Claude `StopFailure` hook | Auto handoff on API errors (rate_limit, overloaded, billing, …) |

## Future polish

| Item | Notes |
|------|--------|
| OpenCode session.created inject | Today runs session-start; full prompt inject depends on OpenCode APIs |
| Codex lifecycle hooks | When Codex exposes them, map to same CLI commands |
| OpenCode/Codex rate-limit auto handoff | Needs equivalent of Claude StopFailure |
| Stop / crash | Still non-goals (noisy / impossible) |

# Agent Stash MCP / Continuity Roadmap

## Done

| Harness | MCP | Auto continuity |
|---------|-----|-----------------|
| **Claude Code** | `init --claude` | SessionStart, PreCompact, SessionEnd, PostToolUse(git commit) |
| **Cursor** | `init --cursor` | Soft (tools only) |
| **OpenCode** | `init --opencode` | Plugin: session.created / compacting / tool.execute.after / session.deleted |
| **Codex** | `init --codex` | Soft: AGENTS.md + MCP tools |

Shared CLI brain (all harnesses):

- `session-start` — inject/print progress brief  
- `checkpoint <reason>` — merge-save progress  
- `log-commit` — audit git commits  

## Design rule

1. Actions live in **CLI/HTTP** (harness-agnostic)  
2. Each harness gets a **thin install adapter** only  
3. Progress JSON + project slug rules stay identical  

## Future polish

| Item | Notes |
|------|--------|
| OpenCode session.created inject | Today runs session-start; full prompt inject depends on OpenCode APIs |
| Codex lifecycle hooks | When Codex exposes them, map to same CLI commands |
| Stop / crash | Still non-goals (noisy / impossible) |

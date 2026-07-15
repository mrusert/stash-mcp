---
name: agent-stash
description: >
  Shared project memory via Agent Stash MCP. Use when resuming work across
  sessions, saving progress before context fills, recording architectural
  decisions, or coordinating with other coding tools (Cursor, Codex).
---

# Agent Stash — Continuity for this project

You have Agent Stash MCP tools. Memory is scoped to the current git project automatically.

## Session start (required when continuing work)

1. Call `resume_progress()`.
2. If it returns a snapshot, continue from `next_step`. Do **not** re-plan from zero or re-discover decisions already listed.
3. Optionally `list_memories()` if you need named decisions beyond the progress snapshot.

## During work

- After a meaningful step (tests green, endpoint done, decision made), call `save_progress` with updated `completed_steps` and `next_step`.
- For decisions that must outlive a single task, call `remember(key, value)` (e.g. `remember("auth-approach", "session cookies, not JWT")`).
- Use `log_event` for significant actions you may want in an audit trail.

## Session end / context full

- Call `save_progress` one more time with the best current state before stopping or compacting.

## Tools (quick map)

| Tool | Use |
|------|-----|
| `resume_progress` | Load last task snapshot |
| `save_progress` | Overwrite task snapshot |
| `remember` / `recall` | Long-lived named decisions |
| `list_memories` / `find_memory` | Discover keys |
| `log_event` / `read_log` | Short-lived project log |

Do not ask the user to paste prior context if Stash already has it — resume first.

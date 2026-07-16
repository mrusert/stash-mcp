## Agent Stash continuity

When Agent Stash MCP tools are available:

1. **Session start** — call `resume_progress`. If a snapshot exists, continue from `next_step`.
2. **During work** — after meaningful steps, call `save_progress`.
3. **Decisions** — use `remember` for choices that must outlive one task.
4. **Audit** — use `log_event` for significant actions.

Project memory is namespaced by git remote / directory automatically.

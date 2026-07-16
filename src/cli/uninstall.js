/**
 * agentstash uninstall
 */

import { uninstallClaudeMcp, uninstallSkill } from "./targets/claude.js";
import { uninstallCursorMcp } from "./targets/cursor.js";
import { uninstallClaudeHooks } from "./hooks.js";
import { uninstallOpenCode } from "./targets/opencode.js";
import { uninstallCodex } from "./targets/codex.js";

/**
 * @param {{ flags: Record<string, string|boolean> }} opts
 */
export async function runUninstall(opts) {
  const flags = opts.flags || {};
  const any =
    flags.claude ||
    flags.cursor ||
    flags.opencode ||
    flags.codex ||
    flags.all;

  const doClaude = !any || flags.claude || flags.all;
  const doCursor = !any || flags.cursor || flags.all;
  const doOpenCode = !any || flags.opencode || flags.all;
  const doCodex = !any || flags.codex || flags.all;

  console.log("Removing Agent Stash configuration...\n");

  if (doClaude) {
    const results = uninstallClaudeMcp();
    if (!results.length) console.log("· Claude MCP: nothing to remove");
    else {
      for (const r of results) {
        if (r.error) console.log(`✗ Claude ${r.method}: ${r.error}`);
        else
          console.log(
            `✓ Claude ${r.method}: removed ${JSON.stringify(r.removed || r.name)}`
          );
      }
    }
    if (!flags["keep-skill"]) {
      const s = uninstallSkill();
      if (s.removed) console.log(`✓ Claude skill removed: ${s.removed}`);
      else console.log("· Claude skill: not present");
    }
    if (!flags["keep-hooks"]) {
      const h = uninstallClaudeHooks();
      if (h.error) console.log(`✗ Claude hooks: ${h.error}`);
      else if (h.removed || h.scriptRemoved) {
        const ev = h.events?.length ? ` (${h.events.join(", ")})` : "";
        console.log(
          `✓ Claude hooks removed${ev}${h.scriptRemoved ? " (+ runner)" : ""}`
        );
      } else console.log("· Claude hooks: not present");
    }
  }

  if (doCursor) {
    const r = uninstallCursorMcp();
    if (r.error) console.log(`✗ Cursor: ${r.error}`);
    else if (r.removed?.length)
      console.log(`✓ Cursor: removed ${r.removed.join(", ")} from ${r.path}`);
    else console.log("· Cursor: nothing to remove");
  }

  if (doOpenCode) {
    const r = uninstallOpenCode();
    if (r.error) console.log(`✗ OpenCode: ${r.error}`);
    else {
      if (r.mcp) console.log("✓ OpenCode MCP removed");
      else console.log("· OpenCode MCP: not present");
      if (r.plugin) console.log("✓ OpenCode plugin removed");
      else console.log("· OpenCode plugin: not present");
    }
  }

  if (doCodex) {
    const r = uninstallCodex();
    if (r.mcp) console.log("✓ Codex MCP section removed");
    else console.log("· Codex MCP: not present");
    if (r.agents) console.log("✓ Codex AGENTS.md block removed");
    else console.log("· Codex AGENTS.md block: not present");
  }

  console.log(`
Done. Restart coding tools to drop MCP connections.
Note: ~/.agentstash/config.json was left in place (contains your API key).
Delete it manually if you want a full wipe: rm -rf ~/.agentstash
`);
}

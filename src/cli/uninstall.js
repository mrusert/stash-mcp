/**
 * agentstash uninstall
 */

import { uninstallClaudeMcp, uninstallSkill } from "./targets/claude.js";
import { uninstallCursorMcp } from "./targets/cursor.js";
import { uninstallSessionStartHook } from "./hooks.js";

/**
 * @param {{ flags: Record<string, string|boolean> }} opts
 */
export async function runUninstall(opts) {
  const flags = opts.flags || {};
  const onlyClaude = flags.claude && !flags.cursor && !flags.all;
  const onlyCursor = flags.cursor && !flags.claude && !flags.all;
  const doClaude = !onlyCursor;
  const doCursor = !onlyClaude;

  console.log("Removing Agent Stash MCP configuration...\n");

  if (doClaude) {
    const results = uninstallClaudeMcp();
    if (!results.length) {
      console.log("· Claude: nothing to remove");
    } else {
      for (const r of results) {
        if (r.error) console.log(`✗ Claude ${r.method}: ${r.error}`);
        else console.log(`✓ Claude ${r.method}: removed ${JSON.stringify(r.removed || r.name)}`);
      }
    }
    if (!flags["keep-skill"]) {
      const s = uninstallSkill();
      if (s.removed) console.log(`✓ Skill removed: ${s.removed}`);
      else console.log("· Skill: not present");
    }
    if (!flags["keep-hooks"]) {
      const h = uninstallSessionStartHook();
      if (h.error) console.log(`✗ Hooks: ${h.error}`);
      else if (h.removed || h.scriptRemoved) {
        console.log(
          `✓ SessionStart hook removed${h.scriptRemoved ? " (+ launcher)" : ""}`
        );
      } else console.log("· SessionStart hook: not present");
    }
  }

  if (doCursor) {
    const r = uninstallCursorMcp();
    if (r.error) console.log(`✗ Cursor: ${r.error}`);
    else if (r.removed?.length) console.log(`✓ Cursor: removed ${r.removed.join(", ")} from ${r.path}`);
    else console.log("· Cursor: nothing to remove");
  }

  console.log(`
Done. Restart Claude Code / Cursor to drop the MCP connection.
Note: ~/.agentstash/config.json was left in place (contains your API key).
Delete it manually if you want a full wipe: rm -rf ~/.agentstash
`);
}

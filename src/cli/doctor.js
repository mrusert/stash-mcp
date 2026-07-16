/**
 * agentstash doctor
 */

import {
  resolveApiKey,
  resolveApiUrl,
  configPath,
  loadConfig,
} from "./config.js";
import { verifyApiKey } from "./register.js";
import { getProjectSlug } from "./project.js";
import { detectClaudeMcp, detectSkill, hasClaudeCli } from "./targets/claude.js";
import { detectCursorMcp, cursorMcpPath } from "./targets/cursor.js";
import { claudeSettingsPath } from "./targets/claude.js";
import { detectClaudeHooks } from "./hooks.js";

/**
 * @param {{ flags: Record<string, string|boolean> }} opts
 */
export async function runDoctor(opts) {
  const flags = opts.flags || {};
  const apiUrl = resolveApiUrl({ apiUrl: flags["api-url"] });
  const apiKey = resolveApiKey({ apiKey: flags["api-key"] });
  let failed = false;

  console.log("Agent Stash doctor\n");

  // Key
  if (!apiKey) {
    console.log("✗ API key: not found");
    console.log("  Set AGENT_STASH_API_KEY, pass --api-key, or run init --register");
    failed = true;
  } else {
    const source = flags["api-key"]
      ? "flag"
      : process.env.AGENT_STASH_API_KEY
        ? "env"
        : "config";
    console.log(`✓ API key: present (${source})`);
    if (source === "config") console.log(`  ${configPath()}`);
  }

  console.log(`  API URL: ${apiUrl}`);

  // Network
  if (apiKey) {
    const check = await verifyApiKey({ apiUrl, apiKey });
    if (check.ok) {
      console.log(`✓ API connectivity: ok (HTTP ${check.status})`);
    } else {
      console.log(`✗ API connectivity: ${check.error || check.status}`);
      failed = true;
    }
  }

  // Project
  const slug = getProjectSlug({
    project: flags.project ? String(flags.project) : undefined,
  });
  console.log(`✓ Project slug (cwd): ${slug}`);
  console.log(`  Progress memory key would be: ${slug}-progress`);

  // Claude
  console.log(`\nClaude Code:`);
  console.log(`  CLI on PATH: ${hasClaudeCli() ? "yes" : "no"}`);
  console.log(`  settings: ${claudeSettingsPath()}`);
  const claude = detectClaudeMcp();
  if (claude.length) {
    for (const c of claude) {
      console.log(`✓ MCP entry: ${c.method}${c.name ? ` (${c.name})` : ""}`);
    }
  } else {
    console.log("· MCP entry: not found");
  }
  const skill = detectSkill();
  if (skill) {
    console.log(`✓ Continuity skill: ${skill.path}`);
  } else {
    console.log("· Continuity skill: not installed (optional)");
  }
  const hook = detectClaudeHooks();
  if (hook.present) {
    const on = Object.entries(hook.events || {})
      .filter(([, v]) => v)
      .map(([k]) => k);
    console.log(
      `✓ Continuity hooks: ${on.join(", ") || "present"}${
        hook.runner ? " (runner ok)" : " (runner missing)"
      }`
    );
  } else {
    console.log(
      "· Continuity hooks: not installed — run init without --no-hooks"
    );
  }

  // Cursor
  console.log(`\nCursor:`);
  console.log(`  config: ${cursorMcpPath()}`);
  const cursor = detectCursorMcp();
  if (cursor.length) {
    for (const c of cursor) {
      console.log(`✓ MCP entry: ${c.name}`);
    }
  } else {
    console.log("· MCP entry: not found");
  }

  if (!claude.length && !cursor.length) {
    console.log(
      "\n✗ No MCP entry in Claude Code or Cursor — run: npx @agentstash/mcp init"
    );
    failed = true;
  }

  const cfg = loadConfig();
  if (cfg.agent_name) {
    console.log(`\nSaved agent name: ${cfg.agent_name}`);
  }

  console.log("");
  if (failed) {
    console.log("Doctor found issues (see ✗ above).");
    process.exitCode = 1;
  } else {
    console.log("All critical checks passed.");
  }
}

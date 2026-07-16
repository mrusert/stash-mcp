/**
 * agentstash init
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import {
  resolveApiKey,
  resolveApiUrl,
  saveConfig,
  loadConfig,
} from "./config.js";
import { registerAgent, verifyApiKey } from "./register.js";
import { installClaudeMcp, installSkill } from "./targets/claude.js";
import { installCursorMcp } from "./targets/cursor.js";
import { installClaudeHooks } from "./hooks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadSkillTemplate() {
  return fs.readFileSync(path.join(__dirname, "skill-template.md"), "utf8");
}

function defaultAgentName() {
  const user = os.userInfo().username || "agent";
  const host = os.hostname().split(".")[0] || "local";
  return `${user}-${host}`
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .slice(0, 64);
}

/**
 * @param {Record<string, string|boolean>} flags
 */
export function resolveTargets(flags) {
  if (flags.all) return { claude: true, cursor: true };
  if (flags.claude && flags.cursor) return { claude: true, cursor: true };
  if (flags.claude) return { claude: true, cursor: false };
  if (flags.cursor) return { claude: false, cursor: true };
  // default: both
  return { claude: true, cursor: true };
}

/**
 * @param {{ flags: Record<string, string|boolean> }} opts
 */
export async function runInit(opts) {
  const flags = opts.flags || {};
  const apiUrl = resolveApiUrl({ apiUrl: flags["api-url"] });
  let apiKey = resolveApiKey({ apiKey: flags["api-key"] });
  const targets = resolveTargets(flags);

  if (!apiKey && flags.register) {
    const agentName = String(flags["agent-name"] || defaultAgentName());
    console.log(`Registering free agent "${agentName}" at ${apiUrl}...`);
    const reg = await registerAgent({ apiUrl, agentName });
    apiKey = reg.api_key;
    saveConfig({
      api_key: apiKey,
      api_url: apiUrl,
      agent_name: reg.agent_name,
    });
    console.log("✓ Registered. API key saved to ~/.agentstash/config.json");
    if (reg.claim_url) {
      console.log(`  Claim/upgrade link (optional): ${reg.claim_url}`);
    }
    console.log(
      "  Keep this key safe — the server will not show it again on later requests."
    );
  } else if (!apiKey) {
    console.error(`No API key found.

  Pass --api-key sk_..., set AGENT_STASH_API_KEY, or run:
    npx @agentstash/mcp init --register --agent-name my-laptop

  Or sign in at https://agentstash.ai and paste your key.`);
    process.exitCode = 1;
    return;
  } else {
    const existing = loadConfig();
    if (!existing.api_key || flags["api-key"]) {
      saveConfig({ api_key: apiKey, api_url: apiUrl });
    }
  }

  console.log(`Verifying API key at ${apiUrl}...`);
  const check = await verifyApiKey({ apiUrl, apiKey });
  if (!check.ok) {
    console.error(`✗ API key check failed: ${check.error || check.status}`);
    process.exitCode = 1;
    return;
  }
  console.log(`✓ API key valid${check.note ? ` (${check.note})` : ""}`);

  const mcpOpts = {
    apiKey,
    apiUrl: apiUrl === "https://agentstash.ai" ? undefined : apiUrl,
    project: flags.project ? String(flags.project) : undefined,
    force: Boolean(flags.force),
  };

  if (targets.claude) {
    console.log("Configuring Claude Code...");
    const r = installClaudeMcp(mcpOpts);
    if (r.ok) {
      console.log(`✓ Claude: ${r.detail || r.action} (${r.method})`);
      if (r.cliNote) console.log(`  note: ${r.cliNote}`);
    } else {
      console.error(`✗ Claude: ${r.detail || "failed"}`);
      process.exitCode = 1;
    }
  }

  if (targets.cursor) {
    console.log("Configuring Cursor...");
    try {
      const r = installCursorMcp(mcpOpts);
      console.log(`✓ Cursor: ${r.detail}`);
    } catch (err) {
      console.error(`✗ Cursor: ${err.message}`);
      process.exitCode = 1;
    }
  }

  if (targets.claude && !flags["no-skill"]) {
    const skill = installSkill(loadSkillTemplate());
    console.log(`✓ Continuity skill: ${skill.path}`);
  }

  // Continuity hooks (Claude Code) — on by default unless --no-hooks
  const wantHooks =
    targets.claude && !flags["no-hooks"] && flags.hooks !== false;
  if (wantHooks) {
    console.log("Installing Claude Code continuity hooks...");
    try {
      const h = installClaudeHooks({ force: Boolean(flags.force) });
      console.log(`✓ Hooks: ${h.detail}`);
      if (h.events?.length) {
        console.log(`  events: ${h.events.join(", ")}`);
      }
    } catch (err) {
      console.error(`✗ Hooks: ${err.message}`);
      process.exitCode = 1;
    }
  } else if (targets.claude && flags["no-hooks"]) {
    console.log("· Continuity hooks skipped (--no-hooks)");
  }

  console.log(`
Done. Next steps:
  1. Restart Claude Code / Cursor so config reloads
  2. Open a project — SessionStart injects prior progress automatically
  3. PreCompact / SessionEnd merge-save progress; git commits are logged
  4. Optional: npx @agentstash/mcp doctor
  5. Optional: npx @agentstash/mcp session-start

Mid-session: the skill still guides rich save_progress / remember.
OpenCode & Codex harness adapters: see ROADMAP.md (CLI actions are shared).
`);
}

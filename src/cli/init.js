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
import {
  installOpenCodeMcp,
  installOpenCodePlugin,
} from "./targets/opencode.js";
import { installCodexMcp, installCodexAgents } from "./targets/codex.js";
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
  const any =
    flags.claude ||
    flags.cursor ||
    flags.opencode ||
    flags.codex ||
    flags.all;

  if (flags.all) {
    return {
      claude: true,
      cursor: true,
      opencode: true,
      codex: true,
    };
  }

  if (!any) {
    // Back-compat default: Claude Code + Cursor
    return {
      claude: true,
      cursor: true,
      opencode: false,
      codex: false,
    };
  }

  return {
    claude: Boolean(flags.claude),
    cursor: Boolean(flags.cursor),
    opencode: Boolean(flags.opencode),
    codex: Boolean(flags.codex),
  };
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

  const installed = [];

  if (targets.claude) {
    console.log("Configuring Claude Code...");
    const r = installClaudeMcp(mcpOpts);
    if (r.ok) {
      console.log(`✓ Claude MCP: ${r.detail || r.action} (${r.method})`);
      if (r.cliNote) console.log(`  note: ${r.cliNote}`);
      installed.push("claude");
    } else {
      console.error(`✗ Claude: ${r.detail || "failed"}`);
      process.exitCode = 1;
    }

    if (!flags["no-skill"]) {
      const skill = installSkill(loadSkillTemplate());
      console.log(`✓ Claude skill: ${skill.path}`);
    }

    const wantHooks = !flags["no-hooks"] && flags.hooks !== false;
    if (wantHooks) {
      console.log("Installing Claude Code continuity hooks...");
      try {
        const h = installClaudeHooks({ force: Boolean(flags.force) });
        console.log(`✓ Claude hooks: ${h.detail}`);
        if (h.events?.length) {
          console.log(`  events: ${h.events.join(", ")}`);
        }
      } catch (err) {
        console.error(`✗ Claude hooks: ${err.message}`);
        process.exitCode = 1;
      }
    } else {
      console.log("· Claude hooks skipped (--no-hooks)");
    }
  }

  if (targets.cursor) {
    console.log("Configuring Cursor...");
    try {
      const r = installCursorMcp(mcpOpts);
      console.log(`✓ Cursor: ${r.detail}`);
      installed.push("cursor");
    } catch (err) {
      console.error(`✗ Cursor: ${err.message}`);
      process.exitCode = 1;
    }
  }

  if (targets.opencode) {
    console.log("Configuring OpenCode...");
    try {
      const m = installOpenCodeMcp(mcpOpts);
      console.log(`✓ OpenCode MCP: ${m.detail}`);
      if (!flags["no-hooks"]) {
        const p = installOpenCodePlugin({ force: Boolean(flags.force) });
        console.log(`✓ OpenCode plugin: ${p.detail}`);
      } else {
        console.log("· OpenCode plugin skipped (--no-hooks)");
      }
      installed.push("opencode");
    } catch (err) {
      console.error(`✗ OpenCode: ${err.message}`);
      process.exitCode = 1;
    }
  }

  if (targets.codex) {
    console.log("Configuring Codex...");
    try {
      const m = installCodexMcp(mcpOpts);
      console.log(`✓ Codex MCP: ${m.detail}`);
      if (!flags["no-skill"]) {
        const a = installCodexAgents({ force: Boolean(flags.force) });
        console.log(`✓ Codex AGENTS.md: ${a.detail}`);
      }
      installed.push("codex");
    } catch (err) {
      console.error(`✗ Codex: ${err.message}`);
      process.exitCode = 1;
    }
  }

  console.log(`
Done. Installed for: ${installed.join(", ") || "(none)"}

Next steps:
  1. Restart the coding tool(s) so MCP reloads
  2. Optional: npx @agentstash/mcp doctor
  3. Optional: npx @agentstash/mcp session-start

Notes:
  • Claude Code: full hooks (SessionStart / PreCompact / SessionEnd / git commit)
  • OpenCode: MCP + plugin (session/compact/tool hooks → same CLI)
  • Codex: MCP + AGENTS.md (soft continuity — call resume_progress / save_progress)
  • Cursor: MCP tools only
`);
}

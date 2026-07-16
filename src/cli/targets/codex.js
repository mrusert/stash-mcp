/**
 * OpenAI Codex install target: MCP in config.toml + AGENTS.md continuity notes.
 *
 * Config: ~/.codex/config.toml
 * Instructions: ~/.codex/AGENTS.md (append/manage marked block)
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const CODEX_SERVER_NAME = "agent-stash";
const BEGIN = "# BEGIN agent-stash";
const END = "# END agent-stash";
const BEGIN_MD = "<!-- BEGIN agent-stash -->";
const END_MD = "<!-- END agent-stash -->";

export function codexConfigPath() {
  return path.join(os.homedir(), ".codex", "config.toml");
}

export function codexAgentsPath() {
  return path.join(os.homedir(), ".codex", "AGENTS.md");
}

/**
 * Escape a string for TOML basic string (double quotes).
 * @param {string} s
 */
export function tomlString(s) {
  return `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/**
 * @param {{ apiKey: string, apiUrl?: string, project?: string }} opts
 */
export function buildCodexMcpSection(opts) {
  const envParts = [`AGENT_STASH_API_KEY = ${tomlString(opts.apiKey)}`];
  if (opts.apiUrl) envParts.push(`AGENT_STASH_URL = ${tomlString(opts.apiUrl)}`);
  if (opts.project) {
    envParts.push(`AGENT_STASH_PROJECT = ${tomlString(opts.project)}`);
  }

  return `${BEGIN}
[mcp_servers.${CODEX_SERVER_NAME}]
command = "npx"
args = ["-y", "@agentstash/mcp"]
env = { ${envParts.join(", ")} }
${END}
`;
}

/**
 * Remove our marked TOML block (and legacy unmarked agent-stash table if force).
 * @param {string} text
 */
export function stripCodexMcpSection(text) {
  let out = String(text || "");
  const re = new RegExp(
    `${BEGIN.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${END.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\n?`,
    "g"
  );
  out = out.replace(re, "");
  // Also strip unmarked table if present
  out = out.replace(
    /\[mcp_servers\.agent-stash\][\s\S]*?(?=\n\[|\n*# BEGIN|\s*$)/g,
    ""
  );
  return out.replace(/\n{3,}/g, "\n\n").trimEnd() + (out.trim() ? "\n" : "");
}

/**
 * @param {{ apiKey: string, apiUrl?: string, project?: string, force?: boolean, configPath?: string }} opts
 */
export function installCodexMcp(opts) {
  const configPath = opts.configPath || codexConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });

  let existing = "";
  if (fs.existsSync(configPath)) {
    existing = fs.readFileSync(configPath, "utf8");
  }

  const hasMarked = existing.includes(BEGIN);
  const hasTable = /\[mcp_servers\.agent-stash\]/.test(existing);

  if ((hasMarked || hasTable) && !opts.force) {
    return {
      ok: true,
      action: "skipped",
      path: configPath,
      detail: `Codex MCP already present in ${configPath} (use --force)`,
    };
  }

  let base = stripCodexMcpSection(existing);
  if (base && !base.endsWith("\n")) base += "\n";
  const section = buildCodexMcpSection(opts);
  const next = (base ? base + "\n" : "") + section;
  fs.writeFileSync(configPath, next.endsWith("\n") ? next : next + "\n", "utf8");

  return {
    ok: true,
    action: hasMarked || hasTable ? "updated" : "added",
    path: configPath,
    detail: `${hasMarked || hasTable ? "updated" : "added"} ${configPath}`,
  };
}

export function buildCodexAgentsBlock() {
  return `${BEGIN_MD}
## Agent Stash (shared project memory)

You have Agent Stash MCP tools when configured (\`agent-stash\` server).

### Session start
- Call \`resume_progress\` when continuing work in this repo.
- If it returns a snapshot, continue from \`next_step\` — do not re-plan from zero.

### During work
- After meaningful steps, call \`save_progress\` with updated completed_steps and next_step.
- Use \`remember\` for decisions that must outlive a single task.
- Use \`log_event\` for significant actions.

### Notes
- Memory is scoped to the git project automatically.
- Codex does not run Claude-style SessionStart hooks; relying on these tools is required for continuity.
- CLI helpers (optional): \`npx @agentstash/mcp session-start\`, \`checkpoint\`, \`log-commit\`.
${END_MD}
`;
}

/**
 * @param {{ force?: boolean, agentsPath?: string }} opts
 */
export function installCodexAgents(opts = {}) {
  const agentsPath = opts.agentsPath || codexAgentsPath();
  fs.mkdirSync(path.dirname(agentsPath), { recursive: true });

  let existing = "";
  if (fs.existsSync(agentsPath)) {
    existing = fs.readFileSync(agentsPath, "utf8");
  }

  if (existing.includes(BEGIN_MD) && !opts.force) {
    return {
      ok: true,
      action: "skipped",
      path: agentsPath,
      detail: "Codex AGENTS.md block already present (use --force)",
    };
  }

  let base = existing;
  if (existing.includes(BEGIN_MD)) {
    base = existing.replace(
      new RegExp(`${BEGIN_MD}[\\s\\S]*?${END_MD}\\n?`, "g"),
      ""
    );
  }
  base = base.trimEnd();
  const block = buildCodexAgentsBlock();
  const next = (base ? base + "\n\n" : "") + block + "\n";
  fs.writeFileSync(agentsPath, next, "utf8");

  return {
    ok: true,
    action: existing.includes(BEGIN_MD) ? "updated" : "added",
    path: agentsPath,
    detail: `${existing.includes(BEGIN_MD) ? "updated" : "added"} ${agentsPath}`,
  };
}

export function uninstallCodex(opts = {}) {
  const results = { mcp: false, agents: false };
  const configPath = opts.configPath || codexConfigPath();
  const agentsPath = opts.agentsPath || codexAgentsPath();

  if (fs.existsSync(configPath)) {
    const text = fs.readFileSync(configPath, "utf8");
    if (text.includes(BEGIN) || /\[mcp_servers\.agent-stash\]/.test(text)) {
      const next = stripCodexMcpSection(text);
      fs.writeFileSync(configPath, next || "", "utf8");
      results.mcp = true;
    }
  }

  if (fs.existsSync(agentsPath)) {
    const text = fs.readFileSync(agentsPath, "utf8");
    if (text.includes(BEGIN_MD)) {
      const next = text
        .replace(new RegExp(`${BEGIN_MD}[\\s\\S]*?${END_MD}\\n?`, "g"), "")
        .trimEnd();
      fs.writeFileSync(agentsPath, next ? next + "\n" : "", "utf8");
      results.agents = true;
    }
  }

  return results;
}

export function detectCodex() {
  const configPath = codexConfigPath();
  const agentsPath = codexAgentsPath();
  let mcp = false;
  let agents = false;
  try {
    if (fs.existsSync(configPath)) {
      const t = fs.readFileSync(configPath, "utf8");
      mcp = t.includes(BEGIN) || /\[mcp_servers\.agent-stash\]/.test(t);
    }
  } catch {
    /* ignore */
  }
  try {
    if (fs.existsSync(agentsPath)) {
      agents = fs.readFileSync(agentsPath, "utf8").includes(BEGIN_MD);
    }
  } catch {
    /* ignore */
  }
  return { mcp, agents, configPath, agentsPath };
}

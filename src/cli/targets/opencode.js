/**
 * OpenCode install target: MCP config + continuity plugin.
 *
 * Config: ~/.config/opencode/opencode.json
 * Plugin: ~/.config/opencode/plugins/agent-stash.js
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readJsonFile, writeJsonFile } from "../merge-json.js";

export const OPENCODE_SERVER_NAME = "agent-stash";

export function opencodeConfigPath() {
  return path.join(os.homedir(), ".config", "opencode", "opencode.json");
}

export function opencodePluginsDir() {
  return path.join(os.homedir(), ".config", "opencode", "plugins");
}

export function opencodePluginPath() {
  return path.join(opencodePluginsDir(), "agent-stash.js");
}

/**
 * @param {{ apiKey: string, apiUrl?: string, project?: string }} opts
 */
export function buildOpenCodeMcpBlock(opts) {
  const environment = {
    AGENT_STASH_API_KEY: opts.apiKey,
  };
  if (opts.apiUrl) environment.AGENT_STASH_URL = opts.apiUrl;
  if (opts.project) environment.AGENT_STASH_PROJECT = opts.project;

  return {
    type: "local",
    command: ["npx", "-y", "@agentstash/mcp"],
    enabled: true,
    environment,
  };
}

/**
 * @param {{ apiKey: string, apiUrl?: string, project?: string, force?: boolean, configPath?: string }} opts
 */
export function installOpenCodeMcp(opts) {
  const configPath = opts.configPath || opencodeConfigPath();
  let existing = {};
  try {
    existing = readJsonFile(configPath) || {};
  } catch (err) {
    throw new Error(`Could not parse ${configPath}: ${err.message}`);
  }

  if (!existing.$schema) {
    existing.$schema = "https://opencode.ai/config.json";
  }

  const mcp = { ...(existing.mcp || {}) };
  if (mcp[OPENCODE_SERVER_NAME] && !opts.force) {
    return {
      ok: true,
      action: "skipped",
      path: configPath,
      detail: `OpenCode MCP "${OPENCODE_SERVER_NAME}" already present (use --force)`,
    };
  }

  const action = mcp[OPENCODE_SERVER_NAME] ? "updated" : "added";
  mcp[OPENCODE_SERVER_NAME] = buildOpenCodeMcpBlock(opts);
  writeJsonFile(configPath, { ...existing, mcp });

  return {
    ok: true,
    action,
    path: configPath,
    detail: `${action} MCP in ${configPath}`,
  };
}

/**
 * Continuity plugin: compact inject + checkpoints + commit log.
 * Uses harness-agnostic CLI with cwd=~/.agentstash for npx safety.
 */
export function buildOpenCodePluginSource() {
  return `/**
 * Agent Stash continuity plugin for OpenCode
 * Installed by: npx @agentstash/mcp init --opencode
 * Marker: agentstash-opencode-plugin
 */
import { spawnSync } from "node:child_process"
import os from "node:os"
import path from "node:path"
import fs from "node:fs"

function safeCwd() {
  const d = path.join(os.homedir(), ".agentstash")
  try {
    fs.mkdirSync(d, { recursive: true })
  } catch {}
  return d
}

function runAgentstash(args, projectCwd) {
  const full = [...args]
  if (projectCwd) {
    full.push("--cwd", projectCwd)
  }
  return spawnSync(
    "npx",
    ["--yes", "--package=@agentstash/mcp", "agentstash", ...full],
    {
      encoding: "utf8",
      cwd: safeCwd(),
      env: process.env,
      timeout: 25000,
    },
  )
}

function toolLooksLikeBash(name) {
  const n = String(name || "").toLowerCase()
  return n === "bash" || n === "shell" || n.includes("bash")
}

function extractCommand(args) {
  if (!args || typeof args !== "object") return ""
  return args.command || args.cmd || args.bash || ""
}

export const AgentStashPlugin = async ({ directory, worktree }) => {
  const projectDir = directory || worktree || process.cwd()

  return {
    event: async ({ event }) => {
      const type = event?.type || event?.name
      if (type === "session.created") {
        // Warm path / soft log — model still has MCP resume_progress
        runAgentstash(["session-start"], projectDir)
      }
      if (type === "session.deleted") {
        runAgentstash(["checkpoint", "session_end"], projectDir)
      }
      // session.compacted fires after compact; we also hook pre-compact below
      if (type === "session.compacted") {
        runAgentstash(["checkpoint", "pre_compact"], projectDir)
      }
    },

    "experimental.session.compacting": async (_input, output) => {
      runAgentstash(["checkpoint", "pre_compact"], projectDir)
      const brief = runAgentstash(["session-start"], projectDir)
      if (brief.stdout && String(brief.stdout).trim()) {
        if (!Array.isArray(output.context)) output.context = []
        output.context.push(String(brief.stdout).trim())
      }
    },

    "tool.execute.after": async (input, _output) => {
      const tool = input?.tool || input?.name || ""
      if (!toolLooksLikeBash(tool)) return
      const command = extractCommand(input?.args || input?.tool_input || {})
      if (!command) return
      // Reuse log-commit CLI (stdin-less path via force only if looks like commit —
      // CLI scans command when we pass via env is hard; spawn with fake stdin)
      const payload = JSON.stringify({
        cwd: projectDir,
        tool_name: "Bash",
        tool_input: { command },
      })
      spawnSync(
        "npx",
        ["--yes", "--package=@agentstash/mcp", "agentstash", "log-commit"],
        {
          encoding: "utf8",
          input: payload,
          cwd: safeCwd(),
          env: process.env,
          timeout: 25000,
        },
      )
    },
  }
}
`
}

export function installOpenCodePlugin(opts = {}) {
  const pluginPath = opts.pluginPath || opencodePluginPath();
  fs.mkdirSync(path.dirname(pluginPath), { recursive: true });
  if (fs.existsSync(pluginPath) && !opts.force) {
    return {
      ok: true,
      action: "skipped",
      path: pluginPath,
      detail: "OpenCode plugin already present (use --force)",
    };
  }
  fs.writeFileSync(pluginPath, buildOpenCodePluginSource(), "utf8");
  return {
    ok: true,
    action: fs.existsSync(pluginPath) ? "updated" : "added",
    path: pluginPath,
    detail: `wrote continuity plugin ${pluginPath}`,
  };
}

export function uninstallOpenCode(opts = {}) {
  const configPath = opts.configPath || opencodeConfigPath();
  const results = { mcp: false, plugin: false };

  try {
    const existing = readJsonFile(configPath);
    if (existing?.mcp?.[OPENCODE_SERVER_NAME]) {
      const mcp = { ...existing.mcp };
      delete mcp[OPENCODE_SERVER_NAME];
      const next = { ...existing, mcp };
      if (Object.keys(mcp).length === 0) delete next.mcp;
      writeJsonFile(configPath, next);
      results.mcp = true;
    }
  } catch (err) {
    results.error = err.message;
  }

  const pluginPath = opts.pluginPath || opencodePluginPath();
  if (fs.existsSync(pluginPath)) {
    fs.unlinkSync(pluginPath);
    results.plugin = true;
  }

  return results;
}

export function detectOpenCode() {
  const configPath = opencodeConfigPath();
  const pluginPath = opencodePluginPath();
  let mcp = false;
  try {
    const cfg = readJsonFile(configPath);
    mcp = Boolean(cfg?.mcp?.[OPENCODE_SERVER_NAME]);
  } catch {
    /* ignore */
  }
  return {
    mcp,
    plugin: fs.existsSync(pluginPath),
    configPath,
    pluginPath,
  };
}

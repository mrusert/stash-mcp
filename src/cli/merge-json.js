/**
 * Safe JSON config merge helpers for MCP client config files.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** Known names we manage for Agent Stash MCP entries. */
export const MANAGED_SERVER_NAMES = ["agent-stash", "agentstash"];

export const CANONICAL_SERVER_NAME = "agent-stash";

/**
 * Build the standard MCP server block for Agent Stash.
 * @param {{ apiKey: string, apiUrl?: string, project?: string }} opts
 */
export function buildMcpServerBlock(opts) {
  const env = {
    AGENT_STASH_API_KEY: opts.apiKey,
  };
  if (opts.apiUrl) env.AGENT_STASH_URL = opts.apiUrl;
  if (opts.project) env.AGENT_STASH_PROJECT = opts.project;

  return {
    command: "npx",
    args: ["-y", "@agentstash/mcp"],
    env,
  };
}

/**
 * Merge our server into a root config object that has (or will have) mcpServers.
 * Does not clobber unrelated keys or other MCP servers.
 *
 * @param {object} config - existing config (mutated copy)
 * @param {object} serverBlock - mcp server definition
 * @param {{ force?: boolean, serverName?: string }} options
 * @returns {{ config: object, action: 'added'|'updated'|'skipped', previousName?: string }}
 */
export function mergeMcpServers(config, serverBlock, options = {}) {
  const force = options.force === true;
  const serverName = options.serverName || CANONICAL_SERVER_NAME;
  const next = { ...config };
  const mcpServers = { ...(next.mcpServers || {}) };

  // Prefer canonical name; drop legacy alias if force-updating
  let previousName;
  for (const name of MANAGED_SERVER_NAMES) {
    if (name in mcpServers && name !== serverName) {
      previousName = name;
    }
  }

  const existingKey = MANAGED_SERVER_NAMES.find((n) => n in mcpServers);

  if (existingKey && !force) {
    return {
      config: next,
      action: "skipped",
      previousName: existingKey,
    };
  }

  if (existingKey && existingKey !== serverName) {
    delete mcpServers[existingKey];
  }

  const action = existingKey ? "updated" : "added";
  mcpServers[serverName] = serverBlock;
  next.mcpServers = mcpServers;
  return { config: next, action, previousName: existingKey };
}

/**
 * Remove managed Agent Stash entries from a config object.
 * @param {object} config
 * @returns {{ config: object, removed: string[] }}
 */
export function removeMcpServers(config) {
  const next = { ...config };
  const mcpServers = { ...(next.mcpServers || {}) };
  const removed = [];
  for (const name of MANAGED_SERVER_NAMES) {
    if (name in mcpServers) {
      delete mcpServers[name];
      removed.push(name);
    }
  }
  if (Object.keys(mcpServers).length === 0) {
    delete next.mcpServers;
  } else {
    next.mcpServers = mcpServers;
  }
  return { config: next, removed };
}

/**
 * Read JSON file or return null if missing.
 * @param {string} filePath
 * @returns {object|null}
 */
export function readJsonFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

/**
 * Atomically write JSON with pretty print. Creates parent dirs.
 * @param {string} filePath
 * @param {object} data
 * @param {{ mode?: number }} opts
 */
export function writeJsonFile(filePath, data, opts = {}) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  const body = JSON.stringify(data, null, 2) + "\n";
  fs.writeFileSync(tmp, body, { encoding: "utf8", mode: opts.mode ?? 0o644 });
  fs.renameSync(tmp, filePath);
  if (opts.mode != null) {
    try {
      fs.chmodSync(filePath, opts.mode);
    } catch {
      /* best effort on platforms that ignore mode */
    }
  }
}

export function expandHome(p) {
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  if (p === "~") return os.homedir();
  return p;
}

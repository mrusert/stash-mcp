/**
 * Local Agent Stash CLI config (~/.agentstash/config.json).
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readJsonFile, writeJsonFile } from "./merge-json.js";

export const DEFAULT_API_URL = "https://agentstash.ai";

export function configDir() {
  return path.join(os.homedir(), ".agentstash");
}

export function configPath() {
  return path.join(configDir(), "config.json");
}

/**
 * @returns {{ api_key?: string, api_url?: string, agent_name?: string }}
 */
export function loadConfig() {
  try {
    return readJsonFile(configPath()) || {};
  } catch {
    return {};
  }
}

/**
 * @param {{ api_key?: string, api_url?: string, agent_name?: string }} data
 */
export function saveConfig(data) {
  const dir = configDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  try {
    fs.chmodSync(dir, 0o700);
  } catch {
    /* ignore */
  }
  const existing = loadConfig();
  const next = {
    ...existing,
    ...data,
    updated_at: new Date().toISOString(),
  };
  writeJsonFile(configPath(), next, { mode: 0o600 });
  return next;
}

/**
 * Resolve API key from flags, env, or saved config.
 * @param {{ apiKey?: string }} opts
 */
export function resolveApiKey(opts = {}) {
  return (
    opts.apiKey ||
    process.env.AGENT_STASH_API_KEY ||
    loadConfig().api_key ||
    null
  );
}

/**
 * @param {{ apiUrl?: string }} opts
 */
export function resolveApiUrl(opts = {}) {
  return (
    opts.apiUrl ||
    process.env.AGENT_STASH_URL ||
    loadConfig().api_url ||
    DEFAULT_API_URL
  ).replace(/\/$/, "");
}

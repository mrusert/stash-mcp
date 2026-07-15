/**
 * Cursor MCP install target (~/.cursor/mcp.json).
 */

import path from "node:path";
import os from "node:os";
import {
  buildMcpServerBlock,
  mergeMcpServers,
  removeMcpServers,
  readJsonFile,
  writeJsonFile,
  CANONICAL_SERVER_NAME,
  MANAGED_SERVER_NAMES,
} from "../merge-json.js";

export function cursorMcpPath() {
  return path.join(os.homedir(), ".cursor", "mcp.json");
}

export function installCursorMcp(opts) {
  const filePath = cursorMcpPath();
  let existing = {};
  try {
    existing = readJsonFile(filePath) || {};
  } catch (err) {
    throw new Error(`Could not parse ${filePath}: ${err.message}`);
  }

  const block = buildMcpServerBlock(opts);
  const { config, action, previousName } = mergeMcpServers(existing, block, {
    force: opts.force,
  });

  if (action === "skipped") {
    return {
      ok: true,
      method: "cursor-mcp.json",
      path: filePath,
      action: "skipped",
      detail: `entry "${previousName}" already present (use --force to replace)`,
    };
  }

  writeJsonFile(filePath, config);
  return {
    ok: true,
    method: "cursor-mcp.json",
    path: filePath,
    action,
    detail: `${action} ${CANONICAL_SERVER_NAME} in ${filePath}`,
  };
}

export function uninstallCursorMcp() {
  const filePath = cursorMcpPath();
  try {
    const existing = readJsonFile(filePath);
    if (!existing) return { removed: [], path: filePath };
    const { config, removed } = removeMcpServers(existing);
    if (removed.length) writeJsonFile(filePath, config);
    return { removed, path: filePath };
  } catch (err) {
    return { error: err.message, path: filePath };
  }
}

export function detectCursorMcp() {
  try {
    const cfg = readJsonFile(cursorMcpPath());
    const servers = cfg?.mcpServers || {};
    const found = [];
    for (const name of MANAGED_SERVER_NAMES) {
      if (name in servers) found.push({ name, present: true });
    }
    return found;
  } catch {
    return [];
  }
}

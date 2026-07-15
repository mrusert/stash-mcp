/**
 * Claude Code MCP + skill install targets.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import {
  buildMcpServerBlock,
  mergeMcpServers,
  removeMcpServers,
  readJsonFile,
  writeJsonFile,
  CANONICAL_SERVER_NAME,
  MANAGED_SERVER_NAMES,
} from "../merge-json.js";

export function claudeSettingsPath() {
  return path.join(os.homedir(), ".claude", "settings.json");
}

export function claudeSkillsDir() {
  return path.join(os.homedir(), ".claude", "skills", "agent-stash");
}

export function hasClaudeCli() {
  const r = spawnSync("claude", ["--version"], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return r.status === 0;
}

/**
 * Try official: claude mcp add -s user ...
 * @returns {{ ok: boolean, method: string, detail?: string }}
 */
export function installViaClaudeCli(opts) {
  const { apiKey, apiUrl, project, force } = opts;

  if (!hasClaudeCli()) {
    return { ok: false, method: "claude-cli", detail: "claude CLI not found on PATH" };
  }

  if (force) {
    for (const name of MANAGED_SERVER_NAMES) {
      spawnSync("claude", ["mcp", "remove", "-s", "user", name], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
    }
  } else {
    // If already present, skip
    const list = spawnSync("claude", ["mcp", "list"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out = `${list.stdout || ""}\n${list.stderr || ""}`;
    if (/agent-stash|agentstash/i.test(out)) {
      return {
        ok: true,
        method: "claude-cli",
        detail: "already configured (use --force to replace)",
        action: "skipped",
      };
    }
  }

  const args = [
    "mcp",
    "add",
    "-s",
    "user",
    CANONICAL_SERVER_NAME,
    "-e",
    `AGENT_STASH_API_KEY=${apiKey}`,
  ];
  if (apiUrl) {
    args.push("-e", `AGENT_STASH_URL=${apiUrl}`);
  }
  if (project) {
    args.push("-e", `AGENT_STASH_PROJECT=${project}`);
  }
  args.push("--", "npx", "-y", "@agentstash/mcp");

  const r = spawnSync("claude", args, {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (r.status !== 0) {
    return {
      ok: false,
      method: "claude-cli",
      detail: (r.stderr || r.stdout || "claude mcp add failed").trim(),
    };
  }

  return {
    ok: true,
    method: "claude-cli",
    detail: (r.stdout || "added").trim(),
    action: "added",
  };
}

/**
 * Fallback: merge into ~/.claude/settings.json
 */
export function installViaSettingsJson(opts) {
  const filePath = claudeSettingsPath();
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
      method: "settings.json",
      path: filePath,
      action: "skipped",
      detail: `entry "${previousName}" already present (use --force to replace)`,
    };
  }

  writeJsonFile(filePath, config);
  return {
    ok: true,
    method: "settings.json",
    path: filePath,
    action,
    detail: `${action} ${CANONICAL_SERVER_NAME} in ${filePath}`,
  };
}

/**
 * Prefer claude CLI; fall back to settings.json.
 */
export function installClaudeMcp(opts) {
  const viaCli = installViaClaudeCli(opts);
  if (viaCli.ok) return viaCli;

  // CLI missing or failed — fall back
  const viaFile = installViaSettingsJson(opts);
  if (!viaCli.ok && viaCli.detail && viaCli.method === "claude-cli") {
    viaFile.cliNote = viaCli.detail;
  }
  return viaFile;
}

export function uninstallClaudeMcp() {
  const results = [];

  if (hasClaudeCli()) {
    for (const name of MANAGED_SERVER_NAMES) {
      const r = spawnSync("claude", ["mcp", "remove", "-s", "user", name], {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      if (r.status === 0) {
        results.push({ method: "claude-cli", name, removed: true });
      }
    }
  }

  const filePath = claudeSettingsPath();
  try {
    const existing = readJsonFile(filePath);
    if (existing) {
      const { config, removed } = removeMcpServers(existing);
      if (removed.length) {
        writeJsonFile(filePath, config);
        results.push({ method: "settings.json", path: filePath, removed });
      }
    }
  } catch (err) {
    results.push({ method: "settings.json", error: err.message });
  }

  return results;
}

/**
 * Detect whether Claude has our MCP entry.
 */
export function detectClaudeMcp() {
  const found = [];

  if (hasClaudeCli()) {
    const list = spawnSync("claude", ["mcp", "list"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    const out = `${list.stdout || ""}\n${list.stderr || ""}`;
    if (/agent-stash|agentstash/i.test(out)) {
      found.push({ method: "claude-cli", present: true });
    }
  }

  try {
    const cfg = readJsonFile(claudeSettingsPath());
    const servers = cfg?.mcpServers || {};
    for (const name of MANAGED_SERVER_NAMES) {
      if (name in servers) {
        found.push({ method: "settings.json", name, present: true });
      }
    }
  } catch {
    /* ignore */
  }

  return found;
}

/**
 * Write continuity skill for Claude Code.
 * @param {string} skillMarkdown
 */
export function installSkill(skillMarkdown) {
  const dir = claudeSkillsDir();
  fs.mkdirSync(dir, { recursive: true });
  const skillPath = path.join(dir, "SKILL.md");
  fs.writeFileSync(skillPath, skillMarkdown, "utf8");
  return { path: skillPath };
}

export function uninstallSkill() {
  const dir = claudeSkillsDir();
  const skillPath = path.join(dir, "SKILL.md");
  if (fs.existsSync(skillPath)) {
    fs.unlinkSync(skillPath);
    try {
      fs.rmdirSync(dir);
    } catch {
      /* non-empty */
    }
    return { removed: skillPath };
  }
  return { removed: null };
}

export function detectSkill() {
  const skillPath = path.join(claudeSkillsDir(), "SKILL.md");
  return fs.existsSync(skillPath) ? { path: skillPath } : null;
}

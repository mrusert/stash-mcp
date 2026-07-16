/**
 * Install / remove Claude Code SessionStart hook for auto-resume.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readJsonFile, writeJsonFile } from "./merge-json.js";
import { HOOK_MARKER } from "./session-brief.js";

export function claudeSettingsPath() {
  return path.join(os.homedir(), ".claude", "settings.json");
}

export function sessionStartScriptPath() {
  return path.join(os.homedir(), ".agentstash", "bin", "session-start.mjs");
}

/**
 * Command string stored in settings.json — includes marker for uninstall.
 */
export function sessionStartHookCommand(scriptPath = sessionStartScriptPath()) {
  return `node "${scriptPath}" # ${HOOK_MARKER}`;
}

export function isOurHookCommand(command) {
  if (!command || typeof command !== "string") return false;
  return (
    command.includes(HOOK_MARKER) ||
    command.includes("agentstash/bin/session-start") ||
    /@agentstash\/mcp.*session-start/.test(command)
  );
}

/**
 * Install launcher under ~/.agentstash/bin that runs `npx @agentstash/mcp session-start`.
 */
export function installSessionStartScript() {
  const dest = sessionStartScriptPath();
  const dir = path.dirname(dest);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const body = `#!/usr/bin/env node
/**
 * Agent Stash SessionStart runner (installed by: npx @agentstash/mcp init)
 * Marker: ${HOOK_MARKER}
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";

let stdin = "";
try {
  if (!process.stdin.isTTY) {
    stdin = fs.readFileSync(0, "utf8");
  }
} catch {
  /* empty */
}

const r = spawnSync(
  "npx",
  ["-y", "@agentstash/mcp", "session-start"],
  {
    encoding: "utf8",
    input: stdin,
    env: process.env,
    timeout: 20000,
  }
);

if (r.stdout) process.stdout.write(r.stdout);
if (r.status !== 0 && !r.stdout) {
  process.stdout.write(
    "## Agent Stash — prior session\\n\\n" +
      "Could not run session-start (" +
      String(r.stderr || r.error || "unknown").slice(0, 200) +
      "). Continuing without progress.\\n"
  );
}
process.exit(0);
`;

  fs.writeFileSync(dest, body, { mode: 0o755 });
  try {
    fs.chmodSync(dest, 0o755);
  } catch {
    /* ignore */
  }
  return dest;
}

function stripOurHandlers(sessionStartGroups) {
  const stripped = [];
  let removed = false;
  for (const group of sessionStartGroups || []) {
    if (!group || typeof group !== "object") continue;
    const handlers = Array.isArray(group.hooks) ? group.hooks : [];
    const kept = handlers.filter((h) => !isOurHookCommand(h?.command));
    if (kept.length !== handlers.length) removed = true;
    if (kept.length === 0) continue;
    stripped.push({ ...group, hooks: kept });
  }
  return { stripped, removed };
}

function hasOurHandler(sessionStartGroups) {
  for (const group of sessionStartGroups || []) {
    for (const h of group?.hooks || []) {
      if (isOurHookCommand(h?.command)) return true;
    }
  }
  return false;
}

/**
 * Merge our SessionStart command into Claude settings without removing other hooks.
 * @param {{ force?: boolean, settingsPath?: string, scriptPath?: string }} opts
 */
export function installSessionStartHook(opts = {}) {
  const settingsPath = opts.settingsPath || claudeSettingsPath();
  const scriptPath = opts.scriptPath || installSessionStartScript();
  const command = sessionStartHookCommand(scriptPath);

  let existing = {};
  try {
    existing = readJsonFile(settingsPath) || {};
  } catch (err) {
    throw new Error(`Could not parse ${settingsPath}: ${err.message}`);
  }

  const hooksRoot = { ...(existing.hooks || {}) };
  const sessionStart = Array.isArray(hooksRoot.SessionStart)
    ? hooksRoot.SessionStart
    : [];

  const hadOurs = hasOurHandler(sessionStart);

  if (hadOurs && !opts.force) {
    // Still refresh the launcher script
    installSessionStartScript();
    return {
      ok: true,
      action: "skipped",
      path: settingsPath,
      scriptPath,
      detail: "SessionStart hook already installed (use --force to replace)",
    };
  }

  const { stripped } = stripOurHandlers(sessionStart);
  stripped.push({
    hooks: [
      {
        type: "command",
        command,
        timeout: 20,
      },
    ],
  });

  const next = {
    ...existing,
    hooks: {
      ...hooksRoot,
      SessionStart: stripped,
    },
  };
  writeJsonFile(settingsPath, next);

  return {
    ok: true,
    action: hadOurs ? "updated" : "added",
    path: settingsPath,
    scriptPath,
    detail: `${hadOurs ? "updated" : "added"} SessionStart hook → ${scriptPath}`,
  };
}

/**
 * @param {{ settingsPath?: string, removeScript?: boolean }} opts
 */
export function uninstallSessionStartHook(opts = {}) {
  const settingsPath = opts.settingsPath || claudeSettingsPath();
  const results = { removed: false, scriptRemoved: false, path: settingsPath };

  try {
    const existing = readJsonFile(settingsPath);
    if (existing?.hooks?.SessionStart) {
      const { stripped, removed } = stripOurHandlers(existing.hooks.SessionStart);
      results.removed = removed;
      const hooks = { ...existing.hooks };
      if (stripped.length === 0) delete hooks.SessionStart;
      else hooks.SessionStart = stripped;
      const next = { ...existing, hooks };
      if (Object.keys(hooks).length === 0) delete next.hooks;
      writeJsonFile(settingsPath, next);
    }
  } catch (err) {
    results.error = err.message;
  }

  if (opts.removeScript !== false) {
    const script = sessionStartScriptPath();
    if (fs.existsSync(script)) {
      fs.unlinkSync(script);
      results.scriptRemoved = true;
      try {
        fs.rmdirSync(path.dirname(script));
      } catch {
        /* non-empty */
      }
    }
  }

  return results;
}

export function detectSessionStartHook(settingsPath = claudeSettingsPath()) {
  try {
    const existing = readJsonFile(settingsPath);
    const present = hasOurHandler(existing?.hooks?.SessionStart);
    return {
      present,
      script: fs.existsSync(sessionStartScriptPath()),
    };
  } catch {
    return { present: false, script: false };
  }
}

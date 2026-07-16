/**
 * Install / remove Claude Code continuity hooks.
 *
 * Events:
 *  - SessionStart  → inject prior progress brief
 *  - PreCompact    → merge-save progress before context compaction
 *  - SessionEnd    → merge-save progress on clean exit
 *  - PostToolUse   → log git commits (Bash matcher)
 *
 * OpenCode / Codex: see ROADMAP.md (same HTTP actions, different install targets).
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { readJsonFile, writeJsonFile } from "./merge-json.js";

/** Shared marker for all Agent Stash hook commands */
export const HOOK_MARKER = "agentstash-hook";

export function claudeSettingsPath() {
  return path.join(os.homedir(), ".claude", "settings.json");
}

export function hookRunnerPath() {
  return path.join(os.homedir(), ".agentstash", "bin", "hook-runner.mjs");
}

/** @deprecated path still cleaned up on uninstall */
export function sessionStartScriptPath() {
  return path.join(os.homedir(), ".agentstash", "bin", "session-start.mjs");
}

export function isOurHookCommand(command) {
  if (!command || typeof command !== "string") return false;
  return (
    command.includes(HOOK_MARKER) ||
    command.includes("agentstash-session-start") ||
    command.includes("agentstash/bin/session-start") ||
    command.includes("agentstash/bin/hook-runner") ||
    /@agentstash\/mcp.*(session-start|checkpoint|log-commit)/.test(command)
  );
}

/**
 * Generic launcher: node hook-runner.mjs <cli args...>
 * Forwards stdin; soft-fails so hooks never block the harness.
 */
export function installHookRunner() {
  const dest = hookRunnerPath();
  const dir = path.dirname(dest);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const body = `#!/usr/bin/env node
/**
 * Agent Stash hook runner (installed by: npx @agentstash/mcp init)
 * Marker: ${HOOK_MARKER}
 * Usage: node hook-runner.mjs <session-start|checkpoint|log-commit> [args...]
 *
 * Important:
 * - Invokes the \`agentstash\` bin explicitly (not bare \`mcp\`) so npx never
 *   looks for a PATH binary named "mcp".
 * - Runs with cwd=~/.agentstash so a project checkout of @agentstash/mcp
 *   (e.g. working inside stash-mcp/) cannot shadow the published package.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const cliArgs = process.argv.slice(2);
if (cliArgs.length === 0) {
  process.stdout.write("agentstash hook-runner: missing command\\n");
  process.exit(0);
}

let stdin = "";
try {
  if (!process.stdin.isTTY) {
    stdin = fs.readFileSync(0, "utf8");
  }
} catch {
  /* empty */
}

const safeCwd = path.join(os.homedir(), ".agentstash");
try {
  fs.mkdirSync(safeCwd, { recursive: true });
} catch {
  /* ignore */
}

// Explicit package + bin name. Avoid: npx @agentstash/mcp <cmd>
// which maps the package name to the "mcp" bin and breaks under local
// package.json shadowing in the stash-mcp repo.
const r = spawnSync(
  "npx",
  ["--yes", "--package=@agentstash/mcp", "agentstash", ...cliArgs],
  {
    encoding: "utf8",
    input: stdin,
    env: process.env,
    timeout: 25000,
    cwd: safeCwd,
  }
);

if (r.stdout) process.stdout.write(r.stdout);
// For checkpoint/log-commit, quiet success is fine; session-start needs stdout.
if (r.status !== 0 && !r.stdout && cliArgs[0] === "session-start") {
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

export function hookCommand(cliArgs, runner = hookRunnerPath()) {
  const args = Array.isArray(cliArgs) ? cliArgs.join(" ") : String(cliArgs);
  return `node "${runner}" ${args} # ${HOOK_MARKER}`;
}

/**
 * Declarative list of Claude Code hooks we manage.
 * @param {string} runner
 */
export function ourHookSpecs(runner = hookRunnerPath()) {
  return [
    {
      event: "SessionStart",
      group: {
        hooks: [
          {
            type: "command",
            command: hookCommand("session-start", runner),
            timeout: 20,
          },
        ],
      },
    },
    {
      event: "PreCompact",
      group: {
        hooks: [
          {
            type: "command",
            command: hookCommand("checkpoint pre_compact", runner),
            timeout: 20,
          },
        ],
      },
    },
    {
      event: "SessionEnd",
      group: {
        hooks: [
          {
            type: "command",
            command: hookCommand("checkpoint session_end", runner),
            timeout: 20,
          },
        ],
      },
    },
    {
      event: "PostToolUse",
      group: {
        matcher: "Bash",
        hooks: [
          {
            type: "command",
            command: hookCommand("log-commit", runner),
            timeout: 20,
          },
        ],
      },
    },
  ];
}

function stripOurFromEvent(groups) {
  const stripped = [];
  let removed = false;
  for (const group of groups || []) {
    if (!group || typeof group !== "object") continue;
    const handlers = Array.isArray(group.hooks) ? group.hooks : [];
    const kept = handlers.filter((h) => !isOurHookCommand(h?.command));
    if (kept.length !== handlers.length) removed = true;
    if (kept.length === 0) continue;
    stripped.push({ ...group, hooks: kept });
  }
  return { stripped, removed };
}

function eventHasOurs(groups) {
  for (const group of groups || []) {
    for (const h of group?.hooks || []) {
      if (isOurHookCommand(h?.command)) return true;
    }
  }
  return false;
}

/**
 * Install full continuity hook set into Claude settings.
 * @param {{ force?: boolean, settingsPath?: string, runnerPath?: string }} opts
 */
export function installClaudeHooks(opts = {}) {
  const settingsPath = opts.settingsPath || claudeSettingsPath();
  const runner = opts.runnerPath || installHookRunner();
  // Also refresh legacy launcher path users may still have
  try {
    installHookRunner();
  } catch {
    /* ignore */
  }

  let existing = {};
  try {
    existing = readJsonFile(settingsPath) || {};
  } catch (err) {
    throw new Error(`Could not parse ${settingsPath}: ${err.message}`);
  }

  const hooksRoot = { ...(existing.hooks || {}) };
  const specs = ourHookSpecs(runner);

  let anyOurs = false;
  for (const spec of specs) {
    if (eventHasOurs(hooksRoot[spec.event])) anyOurs = true;
  }

  if (anyOurs && !opts.force) {
    installHookRunner();
    return {
      ok: true,
      action: "skipped",
      path: settingsPath,
      runnerPath: runner,
      detail:
        "Claude continuity hooks already installed (use --force to replace)",
      events: specs.map((s) => s.event),
    };
  }

  for (const spec of specs) {
    const current = Array.isArray(hooksRoot[spec.event])
      ? hooksRoot[spec.event]
      : [];
    const { stripped } = stripOurFromEvent(current);
    stripped.push(spec.group);
    hooksRoot[spec.event] = stripped;
  }

  const next = { ...existing, hooks: hooksRoot };
  writeJsonFile(settingsPath, next);

  return {
    ok: true,
    action: anyOurs ? "updated" : "added",
    path: settingsPath,
    runnerPath: runner,
    detail: `${anyOurs ? "updated" : "added"} hooks: ${specs
      .map((s) => s.event)
      .join(", ")}`,
    events: specs.map((s) => s.event),
  };
}

/** @deprecated use installClaudeHooks */
export function installSessionStartHook(opts = {}) {
  return installClaudeHooks(opts);
}

/**
 * Remove all Agent Stash hooks + launchers.
 */
export function uninstallClaudeHooks(opts = {}) {
  const settingsPath = opts.settingsPath || claudeSettingsPath();
  const results = {
    removed: false,
    scriptRemoved: false,
    path: settingsPath,
    events: [],
  };

  try {
    const existing = readJsonFile(settingsPath);
    if (existing?.hooks) {
      const hooks = { ...existing.hooks };
      for (const event of Object.keys(hooks)) {
        const { stripped, removed } = stripOurFromEvent(hooks[event]);
        if (removed) {
          results.removed = true;
          results.events.push(event);
        }
        if (stripped.length === 0) delete hooks[event];
        else hooks[event] = stripped;
      }
      const next = { ...existing, hooks };
      if (Object.keys(hooks).length === 0) delete next.hooks;
      writeJsonFile(settingsPath, next);
    }
  } catch (err) {
    results.error = err.message;
  }

  if (opts.removeScript !== false) {
    for (const p of [hookRunnerPath(), sessionStartScriptPath()]) {
      if (fs.existsSync(p)) {
        fs.unlinkSync(p);
        results.scriptRemoved = true;
        try {
          fs.rmdirSync(path.dirname(p));
        } catch {
          /* non-empty */
        }
      }
    }
  }

  return results;
}

/** @deprecated use uninstallClaudeHooks */
export function uninstallSessionStartHook(opts = {}) {
  return uninstallClaudeHooks(opts);
}

export function detectClaudeHooks(settingsPath = claudeSettingsPath()) {
  try {
    const existing = readJsonFile(settingsPath);
    const hooks = existing?.hooks || {};
    const events = {};
    for (const event of [
      "SessionStart",
      "PreCompact",
      "SessionEnd",
      "PostToolUse",
    ]) {
      events[event] = eventHasOurs(hooks[event]);
    }
    const present = Object.values(events).some(Boolean);
    return {
      present,
      events,
      runner: fs.existsSync(hookRunnerPath()),
      legacyScript: fs.existsSync(sessionStartScriptPath()),
    };
  } catch {
    return {
      present: false,
      events: {},
      runner: false,
      legacyScript: false,
    };
  }
}

/** @deprecated use detectClaudeHooks */
export function detectSessionStartHook(settingsPath = claudeSettingsPath()) {
  const d = detectClaudeHooks(settingsPath);
  return {
    present: d.events.SessionStart || d.present,
    script: d.runner || d.legacyScript,
  };
}

// keep old name export for session-start install script
export function installSessionStartScript() {
  return installHookRunner();
}

export function sessionStartHookCommand(scriptPath = hookRunnerPath()) {
  return hookCommand("session-start", scriptPath);
}

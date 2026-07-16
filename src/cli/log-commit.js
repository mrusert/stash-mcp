/**
 * PostToolUse helper: if the tool call was a git commit, append a log event.
 */

import { execSync } from "node:child_process";
import {
  getProjectSlug,
  resolveCredentials,
  parseHookStdin,
} from "./session-brief.js";
import { apiPostJson, getOrCreateProjectLog } from "./api-client.js";

/**
 * @param {string} raw
 */
export function parseToolHookStdin(raw) {
  const base = parseHookStdin(raw);
  if (!raw || !String(raw).trim()) return base;
  try {
    const data = JSON.parse(raw);
    return {
      ...base,
      tool_name: data.tool_name || data.toolName || data.name,
      tool_input: data.tool_input || data.toolInput || data.input || {},
      tool_response: data.tool_response || data.toolResponse,
    };
  } catch {
    return base;
  }
}

/**
 * Extract shell command string from various hook payload shapes.
 * @param {object} toolInput
 */
export function extractBashCommand(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return "";
  return (
    toolInput.command ||
    toolInput.cmd ||
    toolInput.bash ||
    (typeof toolInput === "string" ? toolInput : "") ||
    ""
  );
}

/**
 * @param {string} command
 * @returns {{ isCommit: boolean, message?: string }}
 */
export function detectGitCommit(command) {
  const cmd = String(command || "");
  // Match git commit, including paths like /usr/bin/git commit
  if (!/\bgit\b[\s\S]*\bcommit\b/.test(cmd) && !/\bgit\s+commit\b/.test(cmd)) {
    // also: git -C foo commit
    if (!/\bgit\b/.test(cmd) || !/\bcommit\b/.test(cmd)) {
      return { isCommit: false };
    }
  }
  // Require commit as a git subcommand-ish signal
  if (!/\bcommit\b/.test(cmd)) return { isCommit: false };

  let message;
  const m1 = cmd.match(/-m\s+(['"])([\s\S]*?)\1/);
  if (m1) message = m1[2];
  else {
    const m2 = cmd.match(/-m\s+(\S+)/);
    if (m2) message = m2[1];
  }
  return { isCommit: true, message };
}

function gitHead(cwd) {
  try {
    return execSync("git rev-parse --short HEAD", {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function gitSubject(cwd) {
  try {
    return execSync("git log -1 --pretty=%s", {
      cwd,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

/**
 * @param {{ cwd?: string, project?: string, apiKey?: string, apiUrl?: string, stdinRaw?: string, fetchImpl?: typeof fetch, force?: boolean }} opts
 */
export async function runLogCommit(opts = {}) {
  const parsed = parseToolHookStdin(opts.stdinRaw || "");
  const cwd = opts.cwd || parsed.cwd || process.cwd();
  const project = getProjectSlug({ project: opts.project, cwd });
  const { apiKey, apiUrl } = resolveCredentials({
    apiKey: opts.apiKey,
    apiUrl: opts.apiUrl,
  });

  const toolName = String(parsed.tool_name || "");
  const command = extractBashCommand(parsed.tool_input);

  // Only act on Bash-like tools unless --force (CLI testing)
  const isBash =
    !toolName ||
    /bash/i.test(toolName) ||
    /shell/i.test(toolName) ||
    opts.force;

  if (!isBash && !opts.force) {
    return { ok: true, skipped: true, reason: "not_bash", project };
  }

  const detected = detectGitCommit(command);
  if (!detected.isCommit && !opts.force) {
    return { ok: true, skipped: true, reason: "not_git_commit", project };
  }

  if (!apiKey) {
    return {
      ok: false,
      project,
      error: "no API key",
      message: "log-commit skipped: no API key",
    };
  }

  const hash = gitHead(cwd);
  const subject = detected.message || gitSubject(cwd) || "(commit)";

  const entry = {
    event: "git_commit",
    details: {
      message: subject,
      hash,
      command: command ? command.slice(0, 500) : undefined,
      source: "hook:PostToolUse",
    },
    timestamp: new Date().toISOString(),
  };

  try {
    const logId = await getOrCreateProjectLog({
      apiUrl,
      apiKey,
      project,
      fetchImpl: opts.fetchImpl,
    });
    const res = await apiPostJson({
      apiUrl,
      apiKey,
      path: `/log/${logId}`,
      json: { data: entry, label: "event" },
      fetchImpl: opts.fetchImpl,
    });
    if (!res.ok) {
      return {
        ok: false,
        project,
        error: `POST log failed: HTTP ${res.status}`,
        message: `log-commit failed: HTTP ${res.status}`,
      };
    }
    return {
      ok: true,
      project,
      logged: true,
      entry,
      message: `logged git_commit for ${project}: ${subject}`,
    };
  } catch (err) {
    return {
      ok: false,
      project,
      error: err.message,
      message: `log-commit failed: ${err.message}`,
    };
  }
}

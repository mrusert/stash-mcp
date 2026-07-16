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
 * Strip quotes/comments so "echo 'git commit'" is not a false positive.
 * @param {string} cmd
 */
export function stripShellNoise(cmd) {
  return String(cmd || "")
    // single-quoted strings
    .replace(/'(?:\\'|[^'])*'/g, " ")
    // double-quoted strings (rough)
    .replace(/"(?:\\"|[^"])*"/g, " ")
    // backticks
    .replace(/`[^`]*`/g, " ")
    // line comments
    .replace(/(^|\s)#[^\n]*/g, " ");
}

/**
 * True if this shell segment runs `git … commit` as a subcommand
 * (not "echo git commit", not "git status").
 * @param {string} segment
 */
export function segmentIsGitCommit(segment) {
  const tokens = String(segment || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!tokens.length) return false;

  let i = 0;
  // optional env assignments: FOO=bar git commit
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i])) {
    i += 1;
  }
  if (i >= tokens.length) return false;

  const bin = tokens[i];
  if (bin !== "git" && !bin.endsWith("/git")) return false;
  i += 1;

  // Walk git global options until the first subcommand
  while (i < tokens.length) {
    const t = tokens[i];
    if (t === "commit") return true;
    if (!t.startsWith("-")) {
      // first non-option token is the subcommand
      return false;
    }
    // options that take a separate argument
    if (
      t === "-C" ||
      t === "-c" ||
      t === "--git-dir" ||
      t === "--work-tree" ||
      t === "--namespace" ||
      t === "--config-env"
    ) {
      i += 2;
      continue;
    }
    // -c key=value sometimes as one token already handled; -Cpath rare
    i += 1;
  }
  return false;
}

/**
 * @param {string} command
 * @returns {{ isCommit: boolean, message?: string }}
 */
export function detectGitCommit(command) {
  const original = String(command || "");
  if (!original.trim()) return { isCommit: false };

  // Extract -m message from original (before stripping quotes)
  let message;
  const m1 = original.match(/-m\s+(['"])([\s\S]*?)\1/);
  if (m1) message = m1[2];
  else {
    const m2 = original.match(/-m\s+(\S+)/);
    if (m2) message = m2[1];
  }

  const cleaned = stripShellNoise(original);
  // Split compound commands; any real git commit segment counts
  const segments = cleaned.split(/(?:&&|\|\||;|\n|\|)/);
  const isCommit = segments.some((seg) => segmentIsGitCommit(seg));
  if (!isCommit) return { isCommit: false };
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

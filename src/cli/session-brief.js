/**
 * Fetch and format project progress for SessionStart injection.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const DEFAULT_API_URL = "https://agentstash.ai";
export const HOOK_MARKER = "agentstash-session-start";

export function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

/**
 * @param {{ project?: string, cwd?: string }} opts
 */
export function getProjectSlug(opts = {}) {
  if (opts.project) return slugify(opts.project);
  if (process.env.AGENT_STASH_PROJECT) {
    return slugify(process.env.AGENT_STASH_PROJECT);
  }
  const cwd = opts.cwd || process.cwd();
  try {
    const remote = execSync("git config --get remote.origin.url", {
      encoding: "utf8",
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const match = remote.match(/\/([^/]+?)(\.git)?$/);
    if (match) return slugify(match[1]);
  } catch {
    /* no git */
  }
  return slugify(path.basename(cwd));
}

export function agentstashConfigPath() {
  return path.join(os.homedir(), ".agentstash", "config.json");
}

/**
 * @returns {{ api_key?: string, api_url?: string }}
 */
export function loadAgentstashConfig() {
  try {
    const p = agentstashConfigPath();
    if (!fs.existsSync(p)) return {};
    return JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return {};
  }
}

/**
 * @param {{ apiKey?: string, apiUrl?: string }} opts
 */
export function resolveCredentials(opts = {}) {
  const cfg = loadAgentstashConfig();
  const apiKey =
    opts.apiKey ||
    process.env.AGENT_STASH_API_KEY ||
    cfg.api_key ||
    null;
  const apiUrl = (
    opts.apiUrl ||
    process.env.AGENT_STASH_URL ||
    cfg.api_url ||
    DEFAULT_API_URL
  ).replace(/\/$/, "");
  return { apiKey, apiUrl };
}

/**
 * Parse optional SessionStart stdin JSON from Claude Code.
 * @param {string} raw
 * @returns {{ cwd?: string, source?: string }}
 */
export function parseHookStdin(raw) {
  if (!raw || !String(raw).trim()) return {};
  try {
    const data = JSON.parse(raw);
    return {
      cwd: data.cwd || data.working_directory || data.workDir,
      source: data.source || data.hook_event_name,
    };
  } catch {
    return {};
  }
}

/**
 * @param {{ apiUrl: string, apiKey: string, project: string, fetchImpl?: typeof fetch }} opts
 * @returns {Promise<{ ok: boolean, status?: number, snapshot?: object|string|null, error?: string }>}
 */
export async function fetchProgress(opts) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!fetchImpl) {
    return { ok: false, error: "fetch unavailable" };
  }
  const memKey = `${opts.project}-progress`.slice(0, 128);
  const url = `${opts.apiUrl}/memory/${encodeURIComponent(memKey)}?persistent=true`;
  try {
    const res = await fetchImpl(url, {
      headers: { "X-API-KEY": opts.apiKey },
    });
    if (res.status === 404) {
      return { ok: true, status: 404, snapshot: null };
    }
    if (res.status === 401 || res.status === 403) {
      return { ok: false, status: res.status, error: "unauthorized" };
    }
    if (!res.ok) {
      const text = await res.text();
      return {
        ok: false,
        status: res.status,
        error: text.slice(0, 160) || `HTTP ${res.status}`,
      };
    }
    const text = await res.text();
    try {
      return { ok: true, status: res.status, snapshot: JSON.parse(text) };
    } catch {
      return { ok: true, status: res.status, snapshot: text };
    }
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

/**
 * Format progress for injection into Claude context (stdout of SessionStart hook).
 * @param {{ project: string, snapshot: object|string|null, error?: string, unauthorized?: boolean }} opts
 */
export function formatSessionBrief(opts) {
  const { project, snapshot, error, unauthorized } = opts;
  const lines = [
    "## Agent Stash — prior session",
    "",
    `Project: \`${project}\``,
  ];

  if (unauthorized) {
    lines.push(
      "",
      "Could not load progress (API key missing or unauthorized).",
      "Run: `npx @agentstash/mcp init` or set AGENT_STASH_API_KEY.",
      ""
    );
    return lines.join("\n");
  }

  if (error) {
    lines.push(
      "",
      `Could not load progress: ${error}`,
      "Continuing without prior session state.",
      ""
    );
    return lines.join("\n");
  }

  if (snapshot == null || snapshot === "") {
    lines.push(
      "",
      "No saved progress for this project yet.",
      "After meaningful work, call `save_progress` so the next session can resume.",
      ""
    );
    return lines.join("\n");
  }

  if (typeof snapshot === "string") {
    lines.push("", snapshot.slice(0, 4000), "");
    return lines.join("\n");
  }

  const task = snapshot.task || "(no task)";
  const next = snapshot.next_step || "(none)";
  const saved = snapshot.saved_at || "unknown";
  const completed = Array.isArray(snapshot.completed_steps)
    ? snapshot.completed_steps
    : [];
  const decisions = Array.isArray(snapshot.decisions) ? snapshot.decisions : [];
  const files = Array.isArray(snapshot.files_touched)
    ? snapshot.files_touched
    : [];

  lines.push(
    "",
    "**Do not re-plan from zero.** Continue from the state below unless the user says otherwise.",
    "",
    `- **Task:** ${task}`,
    `- **Next step:** ${next}`,
    `- **Saved at:** ${saved}`
  );

  if (completed.length) {
    lines.push("", "**Completed:**");
    for (const s of completed.slice(0, 20)) lines.push(`- ${s}`);
  }
  if (decisions.length) {
    lines.push("", "**Decisions:**");
    for (const d of decisions.slice(0, 15)) lines.push(`- ${d}`);
  }
  if (files.length) {
    lines.push("", "**Files touched:**");
    for (const f of files.slice(0, 20)) lines.push(`- \`${f}\``);
  }

  lines.push(
    "",
    "When you finish a meaningful step, call `save_progress` to update this snapshot.",
    ""
  );
  return lines.join("\n");
}

/**
 * Full SessionStart pipeline (never throws to caller for hook use).
 * @param {{ cwd?: string, project?: string, apiKey?: string, apiUrl?: string, fetchImpl?: typeof fetch, stdinRaw?: string }} opts
 */
export async function buildSessionStartOutput(opts = {}) {
  const fromStdin = parseHookStdin(opts.stdinRaw || "");
  const cwd = opts.cwd || fromStdin.cwd || process.cwd();
  const project = getProjectSlug({ project: opts.project, cwd });
  const { apiKey, apiUrl } = resolveCredentials({
    apiKey: opts.apiKey,
    apiUrl: opts.apiUrl,
  });

  if (!apiKey) {
    return {
      text: formatSessionBrief({
        project,
        snapshot: null,
        unauthorized: true,
      }),
      project,
      ok: false,
    };
  }

  const result = await fetchProgress({
    apiUrl,
    apiKey,
    project,
    fetchImpl: opts.fetchImpl,
  });

  if (!result.ok) {
    const unauthorized = result.status === 401 || result.status === 403;
    return {
      text: formatSessionBrief({
        project,
        snapshot: null,
        error: result.error,
        unauthorized,
      }),
      project,
      ok: false,
    };
  }

  return {
    text: formatSessionBrief({ project, snapshot: result.snapshot }),
    project,
    ok: true,
    hasProgress: result.snapshot != null,
  };
}

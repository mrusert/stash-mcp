/**
 * Provider-limit / session handoff: freeze progress + print resume targets.
 *
 * Triggers:
 *  - Human: `agentstash handoff` (any harness)
 *  - Claude Code StopFailure hook (rate_limit, overloaded, billing_error, …)
 */

import { spawn, spawnSync } from "node:child_process";
import { runCheckpoint } from "./checkpoint.js";
import { apiPostJson, getOrCreateProjectLog } from "./api-client.js";
import { parseHookStdin } from "./session-brief.js";

/** Supported --to targets */
export const HANDOFF_TARGETS = ["opencode", "claude", "codex", "cursor"];

/**
 * Parse StopFailure (or generic hook) stdin for error fields.
 * @param {string} raw
 * @returns {{ cwd?: string, source?: string, error_type?: string, error_message?: string, hook_event_name?: string }}
 */
export function parseHandoffStdin(raw) {
  const base = parseHookStdin(raw || "");
  if (!raw || !String(raw).trim()) return base;
  try {
    const data = JSON.parse(raw);
    return {
      ...base,
      error_type:
        data.error_type ||
        data.errorType ||
        data.error ||
        data.type ||
        undefined,
      error_message:
        data.error_message ||
        data.errorMessage ||
        data.message ||
        data.detail ||
        undefined,
      hook_event_name:
        data.hook_event_name || data.hookEventName || data.source || undefined,
    };
  } catch {
    return base;
  }
}

/**
 * Resolve binary name for a launch target.
 * @param {string} target
 * @returns {{ bin: string, args: string[], label: string } | null}
 */
export function resolveLaunchSpec(target) {
  const t = String(target || "").toLowerCase();
  if (t === "opencode") {
    return { bin: "opencode", args: [], label: "OpenCode" };
  }
  if (t === "claude") {
    return { bin: "claude", args: [], label: "Claude Code" };
  }
  if (t === "codex") {
    return { bin: "codex", args: [], label: "Codex" };
  }
  if (t === "cursor") {
    // Cursor is a GUI app; we only print instructions
    return null;
  }
  return null;
}

/**
 * Check whether a binary is on PATH (sync).
 * @param {string} bin
 * @param {{ whichImpl?: (bin: string) => boolean }} [opts]
 */
export function isBinaryOnPath(bin, opts = {}) {
  if (opts.whichImpl) return opts.whichImpl(bin);
  try {
    const r = spawnSync("which", [bin], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return r.status === 0 && Boolean(r.stdout && r.stdout.trim());
  } catch {
    return false;
  }
}

/**
 * Human-readable resume card.
 * @param {{
 *   project: string,
 *   ok: boolean,
 *   snapshot?: object|null,
 *   error?: string,
 *   message?: string,
 *   error_type?: string,
 *   error_message?: string,
 *   source?: string,
 *   launched?: { target: string, ok: boolean, detail: string }|null,
 * }} opts
 */
export function formatHandoffCard(opts) {
  const {
    project,
    ok,
    snapshot,
    error,
    message,
    error_type,
    error_message,
    source,
    launched,
  } = opts;

  const lines = [];
  if (ok) {
    lines.push(`✓ Handoff saved for project \`${project}\``);
  } else {
    lines.push(`✗ Handoff incomplete for project \`${project}\``);
    if (error) lines.push(`  Error: ${error}`);
  }

  const snap = snapshot && typeof snapshot === "object" ? snapshot : null;
  if (snap) {
    if (snap.task) lines.push(`  Task: ${snap.task}`);
    if (snap.next_step) lines.push(`  Next: ${snap.next_step}`);
    if (snap.handoff_note) lines.push(`  Note: ${snap.handoff_note}`);
    if (snap.saved_at) lines.push(`  Saved: ${snap.saved_at}`);
  }
  if (message && !snap?.handoff_note) {
    lines.push(`  Note: ${message}`);
  }
  if (error_type) {
    lines.push(
      `  Trigger: ${error_type}${error_message ? ` — ${String(error_message).slice(0, 160)}` : ""}`
    );
  } else if (source) {
    lines.push(`  Source: ${source}`);
  }

  lines.push(
    "",
    "Resume in another tool (same project directory):",
    "  Claude:   claude     → SessionStart injects progress",
    "  OpenCode: opencode   → plugin runs session-start",
    "  Codex:    codex      → AGENTS.md + resume_progress MCP tool",
    "  Cursor:   open project → call resume_progress MCP tool",
    "",
    "Pasteable opener:",
    "  Read Agent Stash progress for this project (resume_progress).",
    "  Continue from next_step. Do not re-plan from zero.",
    "",
    "Manual: npx @agentstash/mcp handoff",
    "        npx @agentstash/mcp handoff --to opencode"
  );

  if (launched) {
    lines.push("");
    lines.push(
      launched.ok
        ? `Launched ${launched.target}: ${launched.detail}`
        : `Could not launch ${launched.target}: ${launched.detail}`
    );
  }

  lines.push("");
  return lines.join("\n");
}

/**
 * Optional: append handoff event to project log.
 */
async function logHandoffEvent(opts) {
  const { apiUrl, apiKey, project, snapshot, error_type, error_message, source, fetchImpl } =
    opts;
  try {
    const logId = await getOrCreateProjectLog({
      apiUrl,
      apiKey,
      project,
      fetchImpl,
    });
    const entry = {
      event: "handoff",
      details: {
        task: snapshot?.task,
        next_step: snapshot?.next_step,
        handoff_note: snapshot?.handoff_note,
        error_type,
        error_message: error_message
          ? String(error_message).slice(0, 500)
          : undefined,
        source: source || "cli",
      },
      timestamp: new Date().toISOString(),
    };
    const res = await apiPostJson({
      apiUrl,
      apiKey,
      path: `/log/${logId}`,
      json: { data: entry, label: "event" },
      fetchImpl,
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Try to spawn a harness in the project directory.
 * @param {{ target: string, cwd: string, spawnImpl?: typeof spawn, whichImpl?: (bin: string) => boolean }} opts
 */
export function tryLaunchTarget(opts) {
  const target = String(opts.target || "").toLowerCase();
  if (!HANDOFF_TARGETS.includes(target)) {
    return {
      target,
      ok: false,
      detail: `unknown target (use: ${HANDOFF_TARGETS.join(", ")})`,
    };
  }
  if (target === "cursor") {
    return {
      target: "cursor",
      ok: false,
      detail: "open the project in Cursor, then call resume_progress",
    };
  }
  const spec = resolveLaunchSpec(target);
  if (!spec) {
    return { target, ok: false, detail: "no launch spec" };
  }
  if (!isBinaryOnPath(spec.bin, { whichImpl: opts.whichImpl })) {
    return {
      target,
      ok: false,
      detail: `\`${spec.bin}\` not on PATH — install it or run manually in this directory`,
    };
  }

  const spawnImpl = opts.spawnImpl || spawn;
  try {
    const child = spawnImpl(spec.bin, spec.args, {
      cwd: opts.cwd,
      detached: true,
      stdio: "ignore",
      env: process.env,
    });
    if (child && typeof child.unref === "function") child.unref();
    return {
      target,
      ok: true,
      detail: `started \`${spec.bin}\` in ${opts.cwd}`,
    };
  } catch (err) {
    return {
      target,
      ok: false,
      detail: err.message || String(err),
    };
  }
}

/**
 * Full handoff pipeline.
 * @param {{
 *   cwd?: string,
 *   project?: string,
 *   apiKey?: string,
 *   apiUrl?: string,
 *   stdinRaw?: string,
 *   message?: string,
 *   to?: string,
 *   noLog?: boolean,
 *   json?: boolean,
 *   fetchImpl?: typeof fetch,
 *   spawnImpl?: typeof spawn,
 *   whichImpl?: (bin: string) => boolean,
 * }} opts
 */
export async function runHandoff(opts = {}) {
  const fromStdin = parseHandoffStdin(opts.stdinRaw || "");
  const message =
    opts.message ||
    (fromStdin.error_type
      ? `Auto handoff (${fromStdin.error_type})`
      : undefined);
  const source =
    fromStdin.hook_event_name === "StopFailure" ||
    fromStdin.error_type
      ? "hook:StopFailure"
      : opts.to
        ? "cli:handoff+launch"
        : "cli:handoff";

  const cp = await runCheckpoint({
    reason: "handoff",
    cwd: opts.cwd || fromStdin.cwd,
    project: opts.project,
    apiKey: opts.apiKey,
    apiUrl: opts.apiUrl,
    stdinRaw: opts.stdinRaw,
    fetchImpl: opts.fetchImpl,
    message,
    error_type: fromStdin.error_type,
    error_message: fromStdin.error_message,
    source,
  });

  let logResult = null;
  if (cp.ok && !opts.noLog && cp.apiKey && cp.apiUrl) {
    logResult = await logHandoffEvent({
      apiUrl: cp.apiUrl,
      apiKey: cp.apiKey,
      project: cp.project,
      snapshot: cp.snapshot,
      error_type: fromStdin.error_type,
      error_message: fromStdin.error_message,
      source,
      fetchImpl: opts.fetchImpl,
    });
  }

  let launched = null;
  if (opts.to) {
    launched = tryLaunchTarget({
      target: opts.to,
      cwd: cp.cwd || opts.cwd || process.cwd(),
      spawnImpl: opts.spawnImpl,
      whichImpl: opts.whichImpl,
    });
  }

  const text = formatHandoffCard({
    project: cp.project,
    ok: cp.ok,
    snapshot: cp.snapshot,
    error: cp.error,
    message,
    error_type: fromStdin.error_type,
    error_message: fromStdin.error_message,
    source,
    launched,
  });

  return {
    ok: cp.ok,
    project: cp.project,
    snapshot: cp.snapshot,
    text,
    source,
    logResult,
    launched,
    error: cp.error,
    message: cp.ok
      ? `handoff ok for ${cp.project}`
      : cp.message || "handoff failed",
  };
}

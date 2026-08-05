/**
 * Merge-save progress checkpoints for PreCompact / SessionEnd hooks.
 * Preserves agent-written task/next_step when present; only stamps metadata.
 */

import {
  getProjectSlug,
  resolveCredentials,
  parseHookStdin,
} from "./session-brief.js";
import { apiGet, apiPutText } from "./api-client.js";

export const VALID_REASONS = new Set([
  "pre_compact",
  "session_end",
  "manual",
  "commit",
  "handoff",
]);

/**
 * @param {object|string|null} existing
 * @param {string} reason
 * @param {{ message?: string, error_type?: string, error_message?: string, source?: string }} [extras]
 */
export function mergeProgressSnapshot(existing, reason, extras = {}) {
  const now = new Date().toISOString();
  let base = {};
  if (existing && typeof existing === "object") {
    base = { ...existing };
  } else if (typeof existing === "string" && existing.trim()) {
    try {
      base = JSON.parse(existing);
    } catch {
      base = {
        task: "(prior unstructured progress)",
        next_step: "Review prior progress text and continue",
        notes: existing.slice(0, 2000),
      };
    }
  }

  if (!base.task) {
    base.task = "(auto checkpoint — no agent progress yet)";
  }
  if (!base.next_step) {
    base.next_step = "Resume work and call save_progress with a real next step";
  }
  if (!Array.isArray(base.completed_steps)) base.completed_steps = [];
  if (!Array.isArray(base.decisions)) base.decisions = [];
  if (!Array.isArray(base.files_touched)) base.files_touched = [];

  base.saved_at = now;
  base.checkpoint_reason = reason;
  base.checkpoint_at = now;

  // Keep a short trail of automatic checkpoints (not agent decisions)
  const trail = Array.isArray(base.auto_checkpoints)
    ? base.auto_checkpoints.slice(-9)
    : [];
  trail.push({ reason, at: now });
  base.auto_checkpoints = trail;

  if (reason === "handoff" || extras.message || extras.error_type) {
    base.handoff_at = now;
    if (extras.message) base.handoff_note = String(extras.message).slice(0, 2000);
    if (extras.error_type) base.handoff_error_type = String(extras.error_type).slice(0, 120);
    if (extras.error_message) {
      base.handoff_error_message = String(extras.error_message).slice(0, 500);
    }
    if (extras.source) base.handoff_source = String(extras.source).slice(0, 80);
  }

  return base;
}

/**
 * @param {{ reason: string, cwd?: string, project?: string, apiKey?: string, apiUrl?: string, stdinRaw?: string, fetchImpl?: typeof fetch, message?: string, error_type?: string, error_message?: string, source?: string }} opts
 */
export async function runCheckpoint(opts = {}) {
  const reason = VALID_REASONS.has(opts.reason) ? opts.reason : "manual";
  const fromStdin = parseHookStdin(opts.stdinRaw || "");
  const cwd = opts.cwd || fromStdin.cwd || process.cwd();
  const project = getProjectSlug({ project: opts.project, cwd });
  const { apiKey, apiUrl } = resolveCredentials({
    apiKey: opts.apiKey,
    apiUrl: opts.apiUrl,
  });

  if (!apiKey) {
    return {
      ok: false,
      project,
      error: "no API key",
      message: "checkpoint skipped: no API key",
    };
  }

  const memKey = `${project}-progress`.slice(0, 128);
  const path = `/memory/${encodeURIComponent(memKey)}?persistent=true`;

  const got = await apiGet({
    apiUrl,
    apiKey,
    path,
    fetchImpl: opts.fetchImpl,
  });

  let existing = null;
  if (got.status === 404) {
    existing = null;
  } else if (!got.ok) {
    return {
      ok: false,
      project,
      error: `GET progress failed: HTTP ${got.status}`,
      message: `checkpoint failed: HTTP ${got.status}`,
    };
  } else {
    existing = got.body;
  }

  const snapshot = mergeProgressSnapshot(existing, reason, {
    message: opts.message,
    error_type: opts.error_type,
    error_message: opts.error_message,
    source: opts.source,
  });
  const put = await apiPutText({
    apiUrl,
    apiKey,
    path,
    body: JSON.stringify(snapshot),
    fetchImpl: opts.fetchImpl,
  });

  if (!put.ok) {
    return {
      ok: false,
      project,
      error: `PUT progress failed: HTTP ${put.status}`,
      message: `checkpoint failed: HTTP ${put.status}`,
      snapshot,
    };
  }

  return {
    ok: true,
    project,
    reason,
    snapshot,
    cwd,
    apiKey,
    apiUrl,
    message: `checkpoint ok: ${reason} for ${project}`,
  };
}

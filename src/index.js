#!/usr/bin/env node
/**
 * Agent Stash MCP Server
 *
 * Provides shared memory tools for Claude Code, Cursor, Codex, and any
 * MCP-compatible AI coding tool. Memory is scoped to the current git project
 * and persists across sessions, machines, and tool switches.
 *
 * Environment variables:
 *   AGENT_STASH_API_KEY  (required) — your API key from agentstash.ai
 *   AGENT_STASH_URL      (optional) — defaults to https://agentstash.ai
 *   AGENT_STASH_PROJECT  (optional) — override project namespace
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { execSync } from "node:child_process";
import path from "node:path";

const API_BASE = (process.env.AGENT_STASH_URL || "https://agentstash.ai").replace(/\/$/, "");
const API_KEY = process.env.AGENT_STASH_API_KEY;

if (!API_KEY) {
  console.error(
    "Error: AGENT_STASH_API_KEY is not set.\n" +
    "Get a free API key at https://agentstash.ai or by running:\n" +
    "  curl -X POST https://agentstash.ai/register/agent \\\n" +
    "    -H 'Content-Type: application/json' \\\n" +
    "    -d '{\"agent_name\": \"my-project\"}'\n"
  );
  process.exit(1);
}

// ── Project namespace ──────────────────────────────────────────────────────

function slugify(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function getProjectSlug() {
  if (process.env.AGENT_STASH_PROJECT) {
    return slugify(process.env.AGENT_STASH_PROJECT);
  }
  try {
    const remote = execSync("git config --get remote.origin.url", {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const match = remote.match(/\/([^/]+?)(\.git)?$/);
    if (match) return slugify(match[1]);
  } catch {}
  return slugify(path.basename(process.cwd()));
}

// ── API helpers ────────────────────────────────────────────────────────────

const HEADERS = {
  "X-API-KEY": API_KEY,
  "Content-Type": "application/json",
};

const TEXT_HEADERS = {
  "X-API-KEY": API_KEY,
  "Content-Type": "text/plain",
};

async function apiGet(path) {
  const res = await fetch(`${API_BASE}${path}`, { headers: HEADERS });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status} ${await res.text()}`);
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

async function apiPut(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PUT",
    headers: TEXT_HEADERS,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`POST ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function apiDelete(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "DELETE",
    headers: HEADERS,
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`DELETE ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

// ── Log (stream) management ────────────────────────────────────────────────
// Cached per process — the log is created once and reused.
// Logs are ephemeral by design: TTL is tier-capped (free: 24h, PRO: 7d, enterprise: 30d).
// renew_on_access extends the log's life during active sessions.
// Near expiry the log is distilled into the project's persistent progress memory.

const LOG_EXPIRY_ACTION = (process.env.AGENT_STASH_LOG_EXPIRY_ACTION || "notify").toLowerCase();
const LOG_DISTILLATION_THRESHOLD = 3600; // trigger distillation when < 1h remaining
const REQUESTED_LOG_TTL = parseInt(process.env.AGENT_STASH_LOG_TTL || "604800", 10); // user override; server clamps to tier max

let _logId = null;
let _logTtl = null;         // actual TTL returned by server (clamped to tier)
let _distillationDone = false;

async function getOrCreateLog(projectSlug) {
  if (_logId) return _logId;

  const result = await apiPost("/log", {
    name: `${projectSlug}-log`,
    ttl: REQUESTED_LOG_TTL,
    renew_on_access: true,
    create_if_missing: true,
    discoverable: false,
    linked_stash: `${projectSlug}-progress`,
  });
  _logId = result.stream_id;
  _logTtl = result.ttl;
  return _logId;
}

async function apiPatch(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "PATCH",
    headers: TEXT_HEADERS,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PATCH ${path} failed: ${res.status} ${await res.text()}`);
  return res.json();
}

async function maybeDistillLog(ttlRemaining, projectSlug) {
  if (_distillationDone) return null;
  if (ttlRemaining === undefined || ttlRemaining > LOG_DISTILLATION_THRESHOLD) return null;

  _distillationDone = true;

  try {
    if (!_logId) return null;
    const logData = await apiGet(`/log/${_logId}?limit=200`);
    const entries = logData?.entries || [];
    if (entries.length === 0) return null;

    const summary = entries.map(e => {
      const ts = e.data?.timestamp || e.created_at || "";
      const ev = e.data?.event || "(event)";
      const det = e.data?.details ? ` — ${JSON.stringify(e.data.details)}` : "";
      return `[${ts}] ${ev}${det}`;
    }).join("\n");

    const progressKey = `${projectSlug}-progress`;
    const progressEnc = encodeURIComponent(progressKey);
    const existing = await apiGet(`/memory/${progressEnc}?persistent=true`);

    if (existing !== null) {
      await apiPatch(
        `/memory/${progressEnc}/append?persistent=true`,
        `\n\n--- Log distilled before expiry ---\n${summary}`
      );
      return { distilled: true };
    }

    // No existing progress memory — follow LOG_EXPIRY_ACTION
    if (LOG_EXPIRY_ACTION === "auto_summarize") {
      try {
        await apiPut(`/memory/${progressEnc}?persistent=true`, summary);
        return { distilled: true, action: "auto_summarize" };
      } catch {
        // Likely at persistent stash cap — fall through to notify
      }
    } else if (LOG_EXPIRY_ACTION === "drop") {
      return null;
    }
    // Default: notify
    return {
      notice: `Project log for '${projectSlug}' expires in < 1 hour. ` +
              `Use save_progress() to preserve context, or upgrade at https://agentstash.ai/pricing-plans`,
    };
  } catch {
    return null; // never let distillation crash the main call
  }
}

// ── Tool implementations ───────────────────────────────────────────────────

async function remember(key, value, schemaId) {
  const project = getProjectSlug();
  const memKey = `${project}-${key}`.slice(0, 128);
  const qs = schemaId ? `?persistent=true&schema_id=${encodeURIComponent(schemaId)}` : "?persistent=true";
  const content = typeof value === "string" ? value : JSON.stringify(value);
  const result = await apiPut(`/memory/${encodeURIComponent(memKey)}${qs}`, content);
  return { key, stored_as: memKey, size: result.size, persistent: result.persistent };
}

async function recall(key) {
  const project = getProjectSlug();
  const memKey = `${project}-${key}`.slice(0, 128);
  const value = await apiGet(`/memory/${encodeURIComponent(memKey)}?persistent=true`);
  if (value === null) return null;
  // Try to parse as JSON, fall back to string
  try { return JSON.parse(value); } catch { return value; }
}

async function listMemories(prefix) {
  const project = getProjectSlug();
  const result = await apiGet("/memories");
  const stashes = result?.stashes || [];
  const projectPrefix = `${project}-${prefix || ""}`;
  return stashes
    .filter(s => s.name.startsWith(projectPrefix))
    .map(s => ({ key: s.name.slice(project.length + 1), size: s.size, persistent: s.persistent }));
}

async function forget(key) {
  const project = getProjectSlug();
  const memKey = `${project}-${key}`.slice(0, 128);
  await apiDelete(`/memory/${encodeURIComponent(memKey)}?persistent=true`);
  return { deleted: true, key };
}

async function saveProgress(task, completedSteps, nextStep, decisions, filesTouched) {
  const project = getProjectSlug();
  const memKey = `${project}-progress`.slice(0, 128);
  const snapshot = {
    task,
    completed_steps: completedSteps || [],
    next_step: nextStep,
    decisions: decisions || [],
    files_touched: filesTouched || [],
    saved_at: new Date().toISOString(),
  };
  await apiPut(`/memory/${encodeURIComponent(memKey)}?persistent=true`, JSON.stringify(snapshot));
  return { saved: true, key: "progress", snapshot };
}

async function resumeProgress() {
  const project = getProjectSlug();
  const memKey = `${project}-progress`.slice(0, 128);
  const value = await apiGet(`/memory/${encodeURIComponent(memKey)}?persistent=true`);
  if (value === null) return null;
  try { return JSON.parse(value); } catch { return value; }
}

async function logEvent(event, details) {
  const project = getProjectSlug();
  const logId = await getOrCreateLog(project);
  const entry = { event, details: details || null, timestamp: new Date().toISOString() };
  const result = await apiPost(`/log/${logId}`, { data: entry, label: "event" });
  const response = { logged: true, entry_id: result.entry_id, ttl_remaining: result.ttl_remaining };
  const distillation = await maybeDistillLog(result.ttl_remaining, project);
  if (distillation) response.distillation = distillation;
  return response;
}

async function readLog(limit) {
  const project = getProjectSlug();
  const logId = await getOrCreateLog(project);
  const result = await apiGet(`/log/${logId}?limit=${limit || 50}`);
  if (!result) return [];
  // Trigger distillation silently if log is near expiry (doesn't affect return value)
  maybeDistillLog(result.ttl_remaining, project).catch(() => {});
  return (result.entries || []).map(e => ({
    entry_id: e.entry_id,
    event: e.data?.event,
    details: e.data?.details,
    timestamp: e.data?.timestamp,
  }));
}

async function findMemory(query) {
  const project = getProjectSlug();
  const result = await apiGet("/memories");
  const stashes = result?.stashes || [];
  const q = query.toLowerCase();
  return stashes
    .filter(s => s.name.startsWith(`${project}-`) && s.name.toLowerCase().includes(q))
    .map(s => ({ key: s.name.slice(project.length + 1), size: s.size, persistent: s.persistent }));
}

// ── Tool definitions ───────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "remember",
    description:
      "Write a memory to the current project's namespace. " +
      "Use after a meaningful decision, completion, or architectural choice. " +
      "Don't use for every tool call — only things worth preserving across sessions. " +
      "Example: remember('auth-approach', 'Using session cookies, not JWT. See ADR-003.')",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Memory key (scoped to current project)" },
        value: { type: "string", description: "Content to store (text or JSON string)" },
        schema_id: { type: "string", description: "Optional schema ID for validation (sch_...)" },
      },
      required: ["key", "value"],
    },
  },
  {
    name: "recall",
    description:
      "Read a memory back. Returns null if not found. " +
      "Use at the start of a session to load context before starting work. " +
      "Example: recall('auth-approach') → 'Using session cookies, not JWT.'",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Memory key to retrieve" },
      },
      required: ["key"],
    },
  },
  {
    name: "list_memories",
    description:
      "List memory keys in the current project. " +
      "Use to discover what's stored without knowing the exact key. " +
      "Example: list_memories() → [{key: 'auth-approach', size: 42}, ...]",
    inputSchema: {
      type: "object",
      properties: {
        prefix: { type: "string", description: "Optional key prefix to filter by" },
      },
    },
  },
  {
    name: "forget",
    description:
      "Delete a memory. Use sparingly — prefer keeping context over deleting it. " +
      "Example: forget('old-approach')",
    inputSchema: {
      type: "object",
      properties: {
        key: { type: "string", description: "Memory key to delete" },
      },
      required: ["key"],
    },
  },
  {
    name: "save_progress",
    description:
      "Write a structured progress snapshot for the current task. " +
      "Use before risky work, after major steps, or when context is getting full. " +
      "Overwrites the previous snapshot — only one progress state is kept per project. " +
      "Example: save_progress('Migrate auth', ['Updated login', 'Updated logout'], 'Update middleware', ['Keep JWT for service-to-service'], ['app/auth.py'])",
    inputSchema: {
      type: "object",
      properties: {
        task: { type: "string", description: "Current task description" },
        completed_steps: {
          type: "array",
          items: { type: "string" },
          description: "Steps completed so far",
        },
        next_step: { type: "string", description: "The immediate next step to take" },
        decisions: {
          type: "array",
          items: { type: "string" },
          description: "Key decisions made during this task",
        },
        files_touched: {
          type: "array",
          items: { type: "string" },
          description: "Files modified in this session",
        },
      },
      required: ["task", "next_step"],
    },
  },
  {
    name: "resume_progress",
    description:
      "Read the most recent progress snapshot for this project. " +
      "Use at session start if you might be continuing prior work. " +
      "Returns null if no progress has been saved.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },
  {
    name: "log_event",
    description:
      "Append an event to the project's working history log. " +
      "The log is temporary and tier-capped (free: 24h, PRO: 7d, enterprise: 30d); " +
      "renew_on_access extends it during active sessions. " +
      "Near expiry the server distills the log into the project's durable progress memory. " +
      "For decisions that must survive across sessions, use remember() instead. " +
      "Response includes ttl_remaining so you can see the active ceiling. " +
      "Example: log_event('migration_complete', {duration_s: 47, tables: ['users', 'posts']})",
    inputSchema: {
      type: "object",
      properties: {
        event: { type: "string", description: "Event name or description" },
        details: {
          type: "object",
          description: "Optional structured details about the event",
        },
      },
      required: ["event"],
    },
  },
  {
    name: "read_log",
    description:
      "Read recent events from the project's working history log. " +
      "The log is temporary and tier-capped (free: 24h, PRO: 7d, enterprise: 30d). " +
      "If the log is empty it may have expired — rely on resume_progress() and recall() for durable context. " +
      "Example: read_log(20) → [{event: 'migration_complete', timestamp: '...'}]",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max number of entries to return (default: 50)",
        },
      },
    },
  },
  {
    name: "find_memory",
    description:
      "Search memories by key name. " +
      "Use when you know roughly what's stored but not the exact key. " +
      "Example: find_memory('auth') → [{key: 'auth-approach', size: 42}]",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Search term matched against memory key names" },
      },
      required: ["query"],
    },
  },
];

// ── Server setup ───────────────────────────────────────────────────────────

const server = new Server(
  { name: "agent-stash", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    let result;

    switch (name) {
      case "remember":
        result = await remember(args.key, args.value, args.schema_id);
        break;
      case "recall":
        result = await recall(args.key);
        break;
      case "list_memories":
        result = await listMemories(args.prefix);
        break;
      case "forget":
        result = await forget(args.key);
        break;
      case "save_progress":
        result = await saveProgress(
          args.task,
          args.completed_steps,
          args.next_step,
          args.decisions,
          args.files_touched
        );
        break;
      case "resume_progress":
        result = await resumeProgress();
        break;
      case "log_event":
        result = await logEvent(args.event, args.details);
        break;
      case "read_log":
        result = await readLog(args.limit);
        break;
      case "find_memory":
        result = await findMemory(args.query);
        break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }

    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);

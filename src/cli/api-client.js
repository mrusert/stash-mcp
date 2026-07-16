/**
 * Minimal Agent Stash HTTP helpers for hook CLI commands.
 */

/**
 * @param {{ apiUrl: string, apiKey: string, path: string, fetchImpl?: typeof fetch }} opts
 */
export async function apiGet(opts) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const res = await fetchImpl(`${opts.apiUrl}${opts.path}`, {
    headers: { "X-API-KEY": opts.apiKey },
  });
  const text = await res.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* plain text */
  }
  return { ok: res.ok, status: res.status, body, text };
}

/**
 * @param {{ apiUrl: string, apiKey: string, path: string, body: string, fetchImpl?: typeof fetch }} opts
 */
export async function apiPutText(opts) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const res = await fetchImpl(`${opts.apiUrl}${opts.path}`, {
    method: "PUT",
    headers: {
      "X-API-KEY": opts.apiKey,
      "Content-Type": "text/plain",
    },
    body: opts.body,
  });
  const text = await res.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  return { ok: res.ok, status: res.status, body, text };
}

/**
 * @param {{ apiUrl: string, apiKey: string, path: string, json: object, fetchImpl?: typeof fetch }} opts
 */
export async function apiPostJson(opts) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const res = await fetchImpl(`${opts.apiUrl}${opts.path}`, {
    method: "POST",
    headers: {
      "X-API-KEY": opts.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(opts.json),
  });
  const text = await res.text();
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    /* ignore */
  }
  return { ok: res.ok, status: res.status, body, text };
}

/**
 * Create-or-get project log id.
 */
export async function getOrCreateProjectLog(opts) {
  const { apiUrl, apiKey, project, fetchImpl } = opts;
  const res = await apiPostJson({
    apiUrl,
    apiKey,
    path: "/log",
    json: {
      name: `${project}-log`,
      ttl: 604800,
      renew_on_access: true,
      create_if_missing: true,
      discoverable: false,
      linked_stash: `${project}-progress`,
    },
    fetchImpl,
  });
  if (!res.ok) {
    throw new Error(
      `create log failed: HTTP ${res.status} ${typeof res.text === "string" ? res.text.slice(0, 160) : ""}`
    );
  }
  const id =
    res.body?.stream_id || res.body?.log_id || res.body?.id || null;
  if (!id) throw new Error("create log response missing id");
  return id;
}

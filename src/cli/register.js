/**
 * Headless agent registration against Agent Stash API.
 */

/**
 * @param {{ apiUrl: string, agentName: string, fetchImpl?: typeof fetch }} opts
 * @returns {Promise<{ api_key: string, agent_name: string, claim_url?: string, raw: object }>}
 */
export async function registerAgent(opts) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  if (!fetchImpl) {
    throw new Error("fetch is not available (need Node 18+)");
  }

  const url = `${opts.apiUrl.replace(/\/$/, "")}/register/agent`;
  const res = await fetchImpl(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ agent_name: opts.agentName }),
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { detail: text };
  }

  if (!res.ok) {
    const msg =
      body.detail ||
      body.message ||
      body.error ||
      `registration failed: HTTP ${res.status}`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }

  const apiKey = body.api_key || body.apiKey;
  if (!apiKey) {
    throw new Error("registration response missing api_key");
  }

  return {
    api_key: apiKey,
    agent_name: body.agent_name || opts.agentName,
    claim_url: body.claim_url || body.claimUrl,
    raw: body,
  };
}

/**
 * Lightweight auth check: list memories (requires valid key).
 * @param {{ apiUrl: string, apiKey: string, fetchImpl?: typeof fetch }} opts
 */
export async function verifyApiKey(opts) {
  const fetchImpl = opts.fetchImpl || globalThis.fetch;
  const url = `${opts.apiUrl.replace(/\/$/, "")}/memories`;
  const res = await fetchImpl(url, {
    headers: { "X-API-KEY": opts.apiKey },
  });
  if (res.status === 401 || res.status === 403) {
    return { ok: false, status: res.status, error: "invalid or unauthorized API key" };
  }
  if (!res.ok) {
    // Some deployments may use different list paths; treat 404 as "reachable but path differs"
    if (res.status === 404) {
      return { ok: true, status: res.status, note: "API reachable (list path 404)" };
    }
    const text = await res.text();
    return { ok: false, status: res.status, error: text.slice(0, 200) };
  }
  return { ok: true, status: res.status };
}

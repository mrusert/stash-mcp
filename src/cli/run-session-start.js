/**
 * CLI: session-start — print progress brief for SessionStart hook / testing.
 */

import fs from "node:fs";
import { buildSessionStartOutput } from "./session-brief.js";

/**
 * Read stdin if piped (Claude hooks pass JSON).
 */
function readStdinSync() {
  try {
    if (process.stdin.isTTY) return "";
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * @param {{ flags?: Record<string, string|boolean> }} opts
 */
export async function runSessionStart(opts = {}) {
  const flags = opts.flags || {};
  const stdinRaw = readStdinSync();

  const result = await buildSessionStartOutput({
    stdinRaw,
    project: flags.project ? String(flags.project) : undefined,
    apiKey: flags["api-key"] ? String(flags["api-key"]) : undefined,
    apiUrl: flags["api-url"] ? String(flags["api-url"]) : undefined,
    cwd: flags.cwd ? String(flags.cwd) : undefined,
  });

  // Always print brief; exit 0 so hooks never block the session
  process.stdout.write(result.text);
  if (!result.text.endsWith("\n")) process.stdout.write("\n");
}

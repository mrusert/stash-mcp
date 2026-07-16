/**
 * CLI: checkpoint <reason>
 */

import fs from "node:fs";
import { runCheckpoint } from "./checkpoint.js";

function readStdinSync() {
  try {
    if (process.stdin.isTTY) return "";
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

/**
 * @param {{ flags?: Record<string, string|boolean>, positionals?: string[] }} opts
 */
export async function runCheckpointCli(opts = {}) {
  const flags = opts.flags || {};
  const reason =
    (opts.positionals && opts.positionals[0]) ||
    flags.reason ||
    "manual";

  const result = await runCheckpoint({
    reason: String(reason),
    stdinRaw: readStdinSync(),
    project: flags.project ? String(flags.project) : undefined,
    apiKey: flags["api-key"] ? String(flags["api-key"]) : undefined,
    apiUrl: flags["api-url"] ? String(flags["api-url"]) : undefined,
    cwd: flags.cwd ? String(flags.cwd) : undefined,
  });

  // Quiet for hooks; still print one line for humans/debugging
  const line = result.message || (result.ok ? "checkpoint ok" : "checkpoint failed");
  process.stdout.write(line + "\n");
  // Never fail the hook process hard
  process.exitCode = 0;
}

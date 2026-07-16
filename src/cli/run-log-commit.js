/**
 * CLI: log-commit
 */

import fs from "node:fs";
import { runLogCommit } from "./log-commit.js";

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
export async function runLogCommitCli(opts = {}) {
  const flags = opts.flags || {};
  const result = await runLogCommit({
    stdinRaw: readStdinSync(),
    project: flags.project ? String(flags.project) : undefined,
    apiKey: flags["api-key"] ? String(flags["api-key"]) : undefined,
    apiUrl: flags["api-url"] ? String(flags["api-url"]) : undefined,
    cwd: flags.cwd ? String(flags.cwd) : undefined,
    force: Boolean(flags.force),
  });

  if (result.skipped) {
    // Silent skip for non-commit Bash tools (avoid noise in hook logs)
    process.exitCode = 0;
    return;
  }

  process.stdout.write((result.message || "log-commit done") + "\n");
  process.exitCode = 0;
}

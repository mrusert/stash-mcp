/**
 * CLI: handoff — freeze progress + print resume targets (optional --to launch).
 */

import fs from "node:fs";
import { runHandoff } from "./handoff.js";

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
export async function runHandoffCli(opts = {}) {
  const flags = opts.flags || {};
  const message =
    (flags.message && String(flags.message)) ||
    (flags.m && String(flags.m)) ||
    undefined;
  const to =
    (flags.to && String(flags.to)) ||
    (opts.positionals && opts.positionals[0]) ||
    undefined;

  const result = await runHandoff({
    stdinRaw: readStdinSync(),
    project: flags.project ? String(flags.project) : undefined,
    apiKey: flags["api-key"] ? String(flags["api-key"]) : undefined,
    apiUrl: flags["api-url"] ? String(flags["api-url"]) : undefined,
    cwd: flags.cwd ? String(flags.cwd) : undefined,
    message,
    to,
    noLog: Boolean(flags["no-log"]),
    json: Boolean(flags.json),
  });

  if (flags.json) {
    process.stdout.write(
      JSON.stringify(
        {
          ok: result.ok,
          project: result.project,
          source: result.source,
          snapshot: result.snapshot,
          launched: result.launched,
          logResult: result.logResult,
          error: result.error,
          message: result.message,
        },
        null,
        2
      ) + "\n"
    );
  } else {
    process.stdout.write(result.text);
    if (!result.text.endsWith("\n")) process.stdout.write("\n");
  }

  // Soft-fail for hooks (StopFailure ignores exit code); humans still see the card
  process.exitCode = 0;
}

#!/usr/bin/env node
/**
 * Package entrypoint for `npx @agentstash/mcp` / `agentstash-mcp`.
 *
 * - No args (or unknown) → MCP server (stdio) — what Claude/Cursor spawn
 * - init | doctor | uninstall | help → install CLI
 */
const cmd = process.argv[2];
const CLI_COMMANDS = new Set([
  "init",
  "doctor",
  "uninstall",
  "help",
  "--help",
  "-h",
  "--version",
  "-V",
]);

if (CLI_COMMANDS.has(cmd)) {
  await import("./cli.js");
} else {
  await import("./index.js");
}

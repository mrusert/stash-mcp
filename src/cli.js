#!/usr/bin/env node
/**
 * Agent Stash install CLI — human-facing setup (not the MCP stdio server).
 */

import { createRequire } from "node:module";
import { parseArgs, printHelp } from "./cli/args.js";
import { runInit } from "./cli/init.js";
import { runDoctor } from "./cli/doctor.js";
import { runUninstall } from "./cli/uninstall.js";
import { runSessionStart } from "./cli/run-session-start.js";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");

const { command, flags } = parseArgs(process.argv.slice(2));

if (flags.version || command === "--version" || command === "-V") {
  console.log(version);
  process.exit(0);
}

if (!command || command === "help" || flags.help || command === "--help" || command === "-h") {
  printHelp();
  process.exit(command && command !== "help" && !flags.help ? 1 : 0);
}

try {
  if (command === "init") {
    await runInit({ flags });
  } else if (command === "doctor") {
    await runDoctor({ flags });
  } else if (command === "uninstall") {
    await runUninstall({ flags });
  } else if (command === "session-start") {
    await runSessionStart({ flags });
  } else {
    console.error(`Unknown command: ${command}\n`);
    printHelp();
    process.exitCode = 1;
  }
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exitCode = 1;
}

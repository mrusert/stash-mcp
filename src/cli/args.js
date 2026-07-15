/**
 * Minimal argv parser for the Agent Stash CLI (no dependencies).
 */

/**
 * @param {string[]} argv - process.argv.slice(2)
 * @returns {{ command: string|null, flags: Record<string, string|boolean>, positionals: string[] }}
 */
export function parseArgs(argv) {
  const flags = {};
  const positionals = [];
  let command = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const eq = a.indexOf("=");
      if (eq !== -1) {
        const key = a.slice(2, eq);
        flags[key] = a.slice(eq + 1);
        continue;
      }
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("-")) {
        // boolean flags that never take values
        const boolFlags = new Set([
          "force",
          "yes",
          "claude",
          "cursor",
          "all",
          "no-skill",
          "register",
          "help",
          "version",
        ]);
        if (boolFlags.has(key)) {
          flags[key] = true;
        } else {
          flags[key] = next;
          i++;
        }
      } else {
        flags[key] = true;
      }
      continue;
    }
    if (a.startsWith("-") && a.length === 2) {
      const map = { f: "force", y: "yes", h: "help", V: "version" };
      const key = map[a.slice(1)] || a.slice(1);
      flags[key] = true;
      continue;
    }
    if (!command) {
      command = a;
    } else {
      positionals.push(a);
    }
  }

  return { command, flags, positionals };
}

export function printHelp() {
  console.log(`Agent Stash CLI — install shared memory for AI coding tools

Usage:
  agentstash <command> [options]
  npx @agentstash/mcp <command> [options]

Commands:
  init         Configure MCP + optional continuity skill
  doctor       Check API key, connectivity, and install status
  uninstall    Remove Agent Stash MCP entries (and skill)
  help         Show this help

init options:
  --api-key <sk_...>     API key (or AGENT_STASH_API_KEY / saved config)
  --api-url <url>        API base URL (default: https://agentstash.ai)
  --register             Register a free agent key (uses --agent-name)
  --agent-name <name>    Name for registration (default: local machine user)
  --claude               Claude Code only
  --cursor               Cursor only
  --all                  Claude Code + Cursor (also the default)
  --force                Replace existing Agent Stash MCP entry
  --no-skill             Skip installing the Claude continuity skill
  --project <slug>       Set AGENT_STASH_PROJECT in MCP env
  --yes                  Non-interactive (required with --register if no TTY prompts)

doctor options:
  --api-key, --api-url   Same as init

Examples:
  npx @agentstash/mcp init --register --agent-name my-laptop --yes
  npx @agentstash/mcp init --api-key sk_... --all
  npx @agentstash/mcp doctor
  agentstash uninstall
`);
}

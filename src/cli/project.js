/**
 * Project namespace — same rules as the MCP server.
 */

import { execSync } from "node:child_process";
import path from "node:path";

export function slugify(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

/**
 * @param {{ project?: string, cwd?: string }} opts
 */
export function getProjectSlug(opts = {}) {
  if (opts.project) return slugify(opts.project);
  if (process.env.AGENT_STASH_PROJECT) {
    return slugify(process.env.AGENT_STASH_PROJECT);
  }
  const cwd = opts.cwd || process.cwd();
  try {
    const remote = execSync("git config --get remote.origin.url", {
      encoding: "utf8",
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    const match = remote.match(/\/([^/]+?)(\.git)?$/);
    if (match) return slugify(match[1]);
  } catch {
    /* no git remote */
  }
  return slugify(path.basename(cwd));
}

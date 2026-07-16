/**
 * Unit tests for Agent Stash install CLI helpers.
 * Run: node --test src/cli.test.js
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  mergeMcpServers,
  removeMcpServers,
  buildMcpServerBlock,
  writeJsonFile,
  readJsonFile,
  CANONICAL_SERVER_NAME,
} from "./cli/merge-json.js";
import { parseArgs } from "./cli/args.js";
import { resolveTargets } from "./cli/init.js";
import { slugify, getProjectSlug } from "./cli/project.js";
import { registerAgent, verifyApiKey } from "./cli/register.js";
import {
  formatSessionBrief,
  parseHookStdin,
  buildSessionStartOutput,
} from "./cli/session-brief.js";
import {
  isOurHookCommand,
  installSessionStartHook,
  uninstallSessionStartHook,
  sessionStartHookCommand,
} from "./cli/hooks.js";

describe("parseArgs", () => {
  it("parses command and long flags", () => {
    const r = parseArgs([
      "init",
      "--api-key",
      "sk_test",
      "--force",
      "--claude",
      "--agent-name",
      "box",
    ]);
    assert.equal(r.command, "init");
    assert.equal(r.flags["api-key"], "sk_test");
    assert.equal(r.flags.force, true);
    assert.equal(r.flags.claude, true);
    assert.equal(r.flags["agent-name"], "box");
  });

  it("parses --key=value", () => {
    const r = parseArgs(["doctor", "--api-url=http://localhost:8000"]);
    assert.equal(r.command, "doctor");
    assert.equal(r.flags["api-url"], "http://localhost:8000");
  });
});

describe("resolveTargets", () => {
  it("defaults to both", () => {
    assert.deepEqual(resolveTargets({}), { claude: true, cursor: true });
  });
  it("respects --claude only", () => {
    assert.deepEqual(resolveTargets({ claude: true }), {
      claude: true,
      cursor: false,
    });
  });
  it("respects --cursor only", () => {
    assert.deepEqual(resolveTargets({ cursor: true }), {
      claude: false,
      cursor: true,
    });
  });
  it("respects --all", () => {
    assert.deepEqual(resolveTargets({ all: true }), {
      claude: true,
      cursor: true,
    });
  });
});

describe("mergeMcpServers", () => {
  const block = buildMcpServerBlock({ apiKey: "sk_new" });

  it("adds server without clobbering others", () => {
    const existing = {
      theme: "dark",
      mcpServers: {
        other: { command: "echo" },
      },
    };
    const { config, action } = mergeMcpServers(existing, block, { force: true });
    assert.equal(action, "added");
    assert.equal(config.theme, "dark");
    assert.equal(config.mcpServers.other.command, "echo");
    assert.equal(
      config.mcpServers[CANONICAL_SERVER_NAME].env.AGENT_STASH_API_KEY,
      "sk_new"
    );
  });

  it("skips when present without force", () => {
    const existing = {
      mcpServers: {
        "agent-stash": buildMcpServerBlock({ apiKey: "sk_old" }),
      },
    };
    const { action } = mergeMcpServers(existing, block, { force: false });
    assert.equal(action, "skipped");
  });

  it("updates with force and migrates agentstash alias", () => {
    const existing = {
      mcpServers: {
        agentstash: buildMcpServerBlock({ apiKey: "sk_old" }),
        keepme: { command: "x" },
      },
    };
    const { config, action } = mergeMcpServers(existing, block, { force: true });
    assert.equal(action, "updated");
    assert.equal(config.mcpServers.agentstash, undefined);
    assert.ok(config.mcpServers["agent-stash"]);
    assert.ok(config.mcpServers.keepme);
  });

  it("removeMcpServers drops managed names only", () => {
    const existing = {
      mcpServers: {
        "agent-stash": block,
        other: { command: "y" },
      },
    };
    const { config, removed } = removeMcpServers(existing);
    assert.deepEqual(removed, ["agent-stash"]);
    assert.equal(config.mcpServers.other.command, "y");
    assert.equal(config.mcpServers["agent-stash"], undefined);
  });
});

describe("writeJsonFile / readJsonFile", () => {
  it("round-trips JSON", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentstash-cli-"));
    const file = path.join(dir, "nested", "cfg.json");
    writeJsonFile(file, { a: 1 });
    assert.deepEqual(readJsonFile(file), { a: 1 });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe("project slug", () => {
  it("slugify normalizes", () => {
    assert.equal(slugify("My Repo.Name"), "my-repo-name");
  });

  it("getProjectSlug respects override", () => {
    assert.equal(getProjectSlug({ project: "Hello World" }), "hello-world");
  });
});

describe("registerAgent / verifyApiKey", () => {
  it("registerAgent posts and returns api_key", async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            api_key: "sk_abc",
            agent_name: "t",
            claim_url: "https://agentstash.ai/auth/claim/x",
          });
        },
      };
    };
    const r = await registerAgent({
      apiUrl: "https://agentstash.ai",
      agentName: "t",
      fetchImpl,
    });
    assert.equal(r.api_key, "sk_abc");
    assert.equal(calls[0].url, "https://agentstash.ai/register/agent");
    assert.equal(JSON.parse(calls[0].init.body).agent_name, "t");
  });

  it("registerAgent throws on error body", async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 429,
      async text() {
        return JSON.stringify({ detail: "rate limited" });
      },
    });
    await assert.rejects(
      () =>
        registerAgent({
          apiUrl: "https://agentstash.ai",
          agentName: "t",
          fetchImpl,
        }),
      /rate limited/
    );
  });

  it("verifyApiKey treats 200 as ok", async () => {
    const fetchImpl = async () => ({
      ok: true,
      status: 200,
      async text() {
        return "{}";
      },
    });
    const r = await verifyApiKey({
      apiUrl: "https://agentstash.ai",
      apiKey: "sk_x",
      fetchImpl,
    });
    assert.equal(r.ok, true);
  });

  it("verifyApiKey treats 401 as fail", async () => {
    const fetchImpl = async () => ({
      ok: false,
      status: 401,
      async text() {
        return "nope";
      },
    });
    const r = await verifyApiKey({
      apiUrl: "https://agentstash.ai",
      apiKey: "sk_bad",
      fetchImpl,
    });
    assert.equal(r.ok, false);
  });
});

describe("buildMcpServerBlock", () => {
  it("uses npx package entry (MCP server, not CLI)", () => {
    const b = buildMcpServerBlock({
      apiKey: "sk_x",
      apiUrl: "http://localhost:8000",
      project: "demo",
    });
    assert.equal(b.command, "npx");
    assert.deepEqual(b.args, ["-y", "@agentstash/mcp"]);
    assert.equal(b.env.AGENT_STASH_API_KEY, "sk_x");
    assert.equal(b.env.AGENT_STASH_URL, "http://localhost:8000");
    assert.equal(b.env.AGENT_STASH_PROJECT, "demo");
  });
});

describe("session-brief", () => {
  it("formatSessionBrief handles empty progress", () => {
    const t = formatSessionBrief({ project: "demo", snapshot: null });
    assert.match(t, /No saved progress/);
    assert.match(t, /demo/);
  });

  it("formatSessionBrief formats snapshot", () => {
    const t = formatSessionBrief({
      project: "demo",
      snapshot: {
        task: "Migrate auth",
        next_step: "Update middleware",
        completed_steps: ["login"],
        decisions: ["cookies"],
        files_touched: ["a.py"],
        saved_at: "2026-01-01T00:00:00Z",
      },
    });
    assert.match(t, /Migrate auth/);
    assert.match(t, /Update middleware/);
    assert.match(t, /cookies/);
  });

  it("parseHookStdin reads cwd", () => {
    const r = parseHookStdin(JSON.stringify({ cwd: "/tmp/proj" }));
    assert.equal(r.cwd, "/tmp/proj");
  });

  it("buildSessionStartOutput formats fetch result", async () => {
    const fetchImpl = async () => ({
      status: 200,
      ok: true,
      async text() {
        return JSON.stringify({
          task: "T",
          next_step: "N",
          completed_steps: [],
          decisions: [],
          files_touched: [],
          saved_at: "t",
        });
      },
    });
    const r = await buildSessionStartOutput({
      project: "demo",
      apiKey: "sk_test",
      apiUrl: "https://example.com",
      fetchImpl,
    });
    assert.match(r.text, /Task:\*\* T|Task:.*T/);
    assert.equal(r.hasProgress, true);
  });

  it("buildSessionStartOutput handles 404", async () => {
    const fetchImpl = async () => ({
      status: 404,
      ok: false,
      async text() {
        return "missing";
      },
    });
    const r = await buildSessionStartOutput({
      project: "demo",
      apiKey: "sk_test",
      apiUrl: "https://example.com",
      fetchImpl,
    });
    assert.match(r.text, /No saved progress/);
    assert.equal(r.hasProgress, false);
  });
});

describe("hooks merge", () => {
  it("recognizes our hook command", () => {
    assert.equal(
      isOurHookCommand(sessionStartHookCommand("/tmp/session-start.mjs")),
      true
    );
    assert.equal(isOurHookCommand("echo hello"), false);
  });

  it("install and uninstall SessionStart without clobbering others", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agentstash-hooks-"));
    const settingsPath = path.join(dir, "settings.json");
    const scriptPath = path.join(dir, "session-start.mjs");
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        model: "sonnet",
        hooks: {
          SessionStart: [
            {
              hooks: [{ type: "command", command: "echo other-hook" }],
            },
          ],
        },
      }),
      "utf8"
    );

    // write script manually so installSessionStartScript isn't required
    fs.writeFileSync(scriptPath, "#!/usr/bin/env node\nconsole.log('ok')\n");

    const r = installSessionStartHook({
      force: true,
      settingsPath,
      scriptPath,
    });
    assert.equal(r.ok, true);
    const after = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const cmds = after.hooks.SessionStart.flatMap((g) =>
      (g.hooks || []).map((h) => h.command)
    );
    assert.ok(cmds.some((c) => c.includes("echo other-hook")));
    assert.ok(cmds.some((c) => isOurHookCommand(c)));

    const u = uninstallSessionStartHook({
      settingsPath,
      removeScript: false,
    });
    assert.equal(u.removed, true);
    const final = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    const cmds2 = (final.hooks?.SessionStart || []).flatMap((g) =>
      (g.hooks || []).map((h) => h.command)
    );
    assert.ok(cmds2.some((c) => c.includes("echo other-hook")));
    assert.ok(!cmds2.some((c) => isOurHookCommand(c)));

    fs.rmSync(dir, { recursive: true, force: true });
  });
});

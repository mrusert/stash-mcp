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

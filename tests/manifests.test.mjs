import test from "node:test";
import assert from "node:assert/strict";
import { readFile, access } from "node:fs/promises";

async function readJson(path) {
  return JSON.parse(await readFile(new URL("../" + path, import.meta.url), "utf8"));
}

test("published plugin manifests stay aligned with the runtime package version", async () => {
  const pkg = await readJson("package.json");
  const plugin = await readJson("plugin.json");
  const codex = await readJson(".codex-plugin/plugin.json");

  assert.equal(plugin.version, pkg.version, "root plugin manifest version must match package.json");
  assert.equal(codex.version, pkg.version, "Codex plugin manifest version must match package.json");
  assert.equal(plugin.name, codex.name, "plugin names must remain aligned");
  assert.equal(plugin.description, codex.description, "plugin descriptions must remain aligned");
  assert.equal(plugin.author.name, "SneppX");
  assert.equal(codex.author.name, "SneppX");
});

test("plugin manifests point to real local skill and MCP configuration files", async () => {
  const plugin = await readJson("plugin.json");
  const codex = await readJson(".codex-plugin/plugin.json");
  const mcp = await readJson(".mcp.json");

  assert.equal(plugin.skills, "./skills");
  assert.equal(codex.skills, "./skills");
  assert.equal(plugin.mcpServers, "./.mcp.json");
  assert.equal(codex.mcpServers, "./.mcp.json");
  await access(new URL("../skills/browser-automation/SKILL.md", import.meta.url));
  assert.deepEqual(Object.keys(mcp.mcpServers), ["brewpilot-local"]);
  assert.equal(mcp.mcpServers["brewpilot-local"].type, "stdio");
  assert.equal(mcp.mcpServers["brewpilot-local"].command, "node");
});

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

test("portable and Codex manifests resolve their actual skill and MCP files", async () => {
  const plugin = await readJson("plugin.json");
  const codex = await readJson(".codex-plugin/plugin.json");
  const portableMcp = await readJson("mcp.json");
  const codexMcp = await readJson(".mcp.json");
  const openaiInterface = plugin.extensions?.["com.openai"]?.interface;

  assert.ok(openaiInterface, "portable manifest must expose its OpenAI interface metadata");
  assert.equal(openaiInterface.displayName, "BrewPilot");
  assert.ok(openaiInterface.shortDescription.length <= 30);
  assert.equal("skills" in plugin, false, "portable skills are discovered from the root skills directory");
  assert.equal("mcpServers" in plugin, false, "portable MCP servers are declared in root mcp.json");
  assert.equal(codex.skills, "./skills");
  assert.equal(codex.mcpServers, "./.mcp.json");
  await access(new URL("../skills/browser-automation/SKILL.md", import.meta.url));
  for (const mcp of [portableMcp, codexMcp]) {
    assert.deepEqual(Object.keys(mcp.mcpServers), ["brewpilot-local"]);
    assert.equal(mcp.mcpServers["brewpilot-local"].type, "stdio");
    assert.equal(mcp.mcpServers["brewpilot-local"].command, "node");
  }
});

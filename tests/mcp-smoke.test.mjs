import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline";

function startServer(home) {
  const child = spawn(process.execPath, [new URL("../server/index.mjs", import.meta.url).pathname], {
    env: { ...process.env, HOME: home, USERPROFILE: home },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = readline.createInterface({ input: child.stdout });
  const pending = new Map();
  let nextId = 0;
  lines.on("line", (line) => {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    if (pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    }
  });
  return {
    child,
    call(method, params = {}) {
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timed out: ${method}`)); }, 5000);
        pending.set(id, {
          resolve: (value) => { clearTimeout(timer); resolve(value); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      });
    },
    close() { lines.close(); child.kill(); },
  };
}

test("MCP server exposes permission tools and gates system information", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "brewpilot-mcp-"));
  const server = startServer(home);
  try {
    const initialized = await server.call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    assert.equal(initialized.serverInfo.version, "0.2.0");
    const listed = await server.call("tools/list");
    const names = listed.tools.map((tool) => tool.name);
    assert.ok(names.includes("permissions_approve_once"));
    assert.ok(names.includes("system_info"));
    const denied = await server.call("tools/call", { name: "system_info", arguments: {} });
    const deniedPayload = JSON.parse(denied.content[0].text);
    assert.equal(deniedPayload.status, "approval_required");
    await server.call("tools/call", { name: "permissions_approve_once", arguments: { capability: "system", operation: "info", resource: "system" } });
    const allowed = await server.call("tools/call", { name: "system_info", arguments: {} });
    const info = JSON.parse(allowed.content[0].text);
    assert.ok(info.platformName);
    assert.ok(info.memory.totalBytes > 0);
  } finally {
    server.close();
    await rm(home, { recursive: true, force: true });
  }
});

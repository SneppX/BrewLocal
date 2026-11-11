import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline";

function startServer(home) {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../server/index.mjs", import.meta.url))], {
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
    assert.equal(initialized.serverInfo.version, "0.3.2");
    const listed = await server.call("tools/list");
    const names = listed.tools.map((tool) => tool.name);
    assert.ok(names.includes("permissions_approve_once"));
    assert.ok(names.includes("system_info"));
    const denied = await server.call("tools/call", { name: "system_info", arguments: {} });
    const deniedPayload = JSON.parse(denied.content[0].text);
    assert.equal(deniedPayload.status, "approval_required");
    assert.ok(deniedPayload.approval.requestId);
    assert.match(deniedPayload.approval.argumentDigest, /^[a-f0-9]{64}$/);
    await server.call("tools/call", { name: "permissions_approve_once", arguments: { capability: deniedPayload.permission.capability, operation: deniedPayload.permission.operation, resource: deniedPayload.permission.resource, requestId: deniedPayload.approval.requestId, argumentDigest: deniedPayload.approval.argumentDigest } });
    const allowed = await server.call("tools/call", { name: "system_info", arguments: {} });
    const info = JSON.parse(allowed.content[0].text);
    assert.ok(info.platformName);
    assert.ok(info.memory.totalBytes > 0);
  } finally {
    server.close();
    await rm(home, { recursive: true, force: true });
  }
});


async function callTool(server, name, args = {}) {
  const response = await server.call("tools/call", { name, arguments: args });
  return JSON.parse(response.content[0].text);
}

async function approveExact(server, result) {
  assert.equal(result.status, "approval_required");
  await callTool(server, "permissions_approve_once", {
    capability: result.permission.capability,
    operation: result.permission.operation,
    resource: result.permission.resource,
    requestId: result.approval.requestId,
    argumentDigest: result.approval.argumentDigest,
  });
}

test("MCP server exposes scoped file tools and enforces one-time destructive approval", async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), "brewpilot-files-mcp-"));
  const server = startServer(home);
  try {
    await server.call("initialize", { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } });
    const listed = await server.call("tools/list");
    const names = listed.tools.map((tool) => tool.name);
    for (const name of ["files_list", "files_read", "files_write", "files_delete"]) assert.ok(names.includes(name));

    const directory = path.join(home, "workspace");
    await mkdir(directory);
    const canonicalDirectory = await realpath(directory);
    const filePath = path.join(canonicalDirectory, "notes.txt");

    await callTool(server, "permissions_set", { capability: "files", operation: "list", resource: canonicalDirectory, mode: "always" });
    const listing = await callTool(server, "files_list", { directory: canonicalDirectory });
    assert.equal(listing.totalEntries, 0);

    await callTool(server, "permissions_set", { capability: "files", operation: "write", resource: filePath, mode: "always" });
    const created = await callTool(server, "files_write", { filePath, content: "first version" });
    assert.equal(created.created, true);

    const overwriteArgs = { filePath, content: "second version", overwrite: true };
    const overwriteApproval = await callTool(server, "files_write", overwriteArgs);
    await approveExact(server, overwriteApproval);
    const overwritten = await callTool(server, "files_write", overwriteArgs);
    assert.equal(overwritten.overwritten, true);

    await callTool(server, "permissions_set", { capability: "files", operation: "read", resource: filePath, mode: "always" });
    const read = await callTool(server, "files_read", { filePath });
    assert.equal(read.content, "second version");

    await callTool(server, "permissions_set", { capability: "files", operation: "delete", resource: filePath, mode: "always" });
    const deleteApproval = await callTool(server, "files_delete", { filePath });
    await approveExact(server, deleteApproval);
    const deleted = await callTool(server, "files_delete", { filePath });
    assert.equal(deleted.deleted, true);
  } finally {
    server.close();
    await rm(home, { recursive: true, force: true });
  }
});

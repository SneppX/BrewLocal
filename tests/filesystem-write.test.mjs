import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deleteFile, writeTextFile } from "../server/core/filesystem.mjs";

test("creates bounded UTF-8 text files without overwriting existing data", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "brewpilot-write-"));
  try {
    const file = path.join(root, "notes.txt");
    const created = await writeTextFile(file, "hello BrewPilot", { maxBytes: 1024 });
    assert.equal(created.created, true);
    assert.equal(created.bytes, 15);
    assert.equal(await readFile(file, "utf8"), "hello BrewPilot");
    await assert.rejects(writeTextFile(file, "replacement"), /already exists/);
    assert.equal(await readFile(file, "utf8"), "hello BrewPilot");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("overwrites only when explicitly requested and uses the bounded write limit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "brewpilot-write-"));
  try {
    const file = path.join(root, "notes.txt");
    await writeFile(file, "old");
    const result = await writeTextFile(file, "new value", { overwrite: true, maxBytes: 32 });
    assert.equal(result.overwritten, true);
    assert.equal(await readFile(file, "utf8"), "new value");
    await assert.rejects(writeTextFile(file, "x".repeat(33), { overwrite: true, maxBytes: 32 }), /write limit/);
    await assert.rejects(writeTextFile(path.join(root, "nul.txt"), "bad\0text"), /NUL/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("deletes regular files and rejects missing paths and directories", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "brewpilot-delete-"));
  try {
    const file = path.join(root, "delete.txt");
    await writeFile(file, "temporary");
    assert.deepEqual(await deleteFile(file), { path: file, deleted: true });
    await assert.rejects(deleteFile(file), /does not exist/);
    await assert.rejects(deleteFile(root), /regular file/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("refuses to write through a symbolic link", async (t) => {
  if (process.platform === "win32") return t.skip("Symlink creation requires platform-specific privileges on Windows.");
  const root = await mkdtemp(path.join(os.tmpdir(), "brewpilot-symlink-"));
  try {
    const target = path.join(root, "target.txt");
    const link = path.join(root, "link.txt");
    await writeFile(target, "protected");
    await symlink(target, link);
    await assert.rejects(writeTextFile(link, "changed", { overwrite: true }), /Symbolic links/);
    assert.equal(await readFile(target, "utf8"), "protected");
    await assert.rejects(deleteFile(link), /Symbolic links/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { listDirectory, readTextFile, resolveDirectory, resolveTextFile } from "../server/core/filesystem.mjs";

test("directory listing is shallow, sorted and bounded", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "brewpilot-files-"));
  try {
    await writeFile(path.join(root, "z.txt"), "z");
    await writeFile(path.join(root, "a.txt"), "a");
    await mkdir(path.join(root, "nested"));
    const result = await listDirectory(root, { maxEntries: 2 });
    assert.equal(result.totalEntries, 3);
    assert.equal(result.truncated, true);
    assert.deepEqual(result.entries.map((entry) => entry.name), ["a.txt", "nested"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("text file reads return UTF-8 content within the configured limit", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "brewpilot-files-"));
  try {
    const file = path.join(root, "notes.txt");
    await writeFile(file, "hello BrewPilot", "utf8");
    const result = await readTextFile(file, { maxBytes: 1024 });
    assert.equal(result.content, "hello BrewPilot");
    assert.equal(result.bytes, 15);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("file reads reject oversized and binary content", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "brewpilot-files-"));
  try {
    const large = path.join(root, "large.txt");
    const binary = path.join(root, "binary.bin");
    await writeFile(large, "x".repeat(2048));
    await writeFile(binary, Buffer.from([0, 1, 2, 3]));
    await assert.rejects(readTextFile(large, { maxBytes: 1024 }), /exceeds/);
    await assert.rejects(readTextFile(binary), /Binary/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("path resolution requires absolute paths and expected file types", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "brewpilot-files-"));
  try {
    await assert.rejects(resolveDirectory("relative/path"), /absolute/);
    await assert.rejects(resolveTextFile(root), /regular file/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

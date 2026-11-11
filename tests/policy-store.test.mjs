import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PolicyStore } from "../server/core/policy-store.mjs";

test("policy store initializes explicit ask policies and persists updates", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "brewpilot-policy-"));
  try {
    const store = new PolicyStore(dir);
    const initial = await store.load();
    assert.equal(initial.some((p) => p.capability === "browser" && p.mode === "ask"), true);
    const updated = [{ capability: "system", operation: "info", resource: "system", mode: "always" }];
    await store.save(updated);
    assert.deepEqual(await store.load(), updated);
    const raw = JSON.parse(await readFile(path.join(dir, "permissions.json"), "utf8"));
    assert.equal(raw.version, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

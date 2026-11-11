import test from "node:test";
import assert from "node:assert/strict";
import { AuditLog } from "../server/core/audit.mjs";

test("audit log hashes absolute local paths instead of retaining them", () => {
  const log = new AuditLog();
  const event = log.record({ action: "permission_check", capability: "files", operation: "read", resource: "/home/user/private.txt", decision: "ask" });
  assert.match(event.resource, /^\[LOCAL_PATH:[a-f0-9]{12}\]$/);
  assert.equal(event.resource.includes("private.txt"), false);
});

test("audit log retains non-path resources for useful diagnostics", () => {
  const log = new AuditLog();
  const event = log.record({ capability: "browser", operation: "navigate", resource: "example.com", decision: "allow" });
  assert.equal(event.resource, "example.com");
});

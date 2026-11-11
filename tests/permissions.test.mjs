import test from "node:test";
import assert from "node:assert/strict";
import { PermissionManager } from "../server/core/permissions.mjs";

const request = { capability: "browser", operation: "navigate", resource: "example.com" };

test("deny by default when no matching policy exists", () => {
  assert.equal(new PermissionManager().evaluate(request).decision, "deny");
});

test("ask policy blocks until an exact one-time approval is consumed", () => {
  const manager = new PermissionManager([{ capability: "browser", operation: "*", resource: "*", mode: "ask" }]);
  assert.equal(manager.evaluate(request).decision, "ask");
  const approval = manager.createApprovalRequest(request, "a".repeat(64));
  manager.grantOnce(request, approval);
  assert.equal(manager.evaluate({ ...request, argumentDigest: "a".repeat(64) }).decision, "allow");
  assert.equal(manager.evaluate({ ...request, argumentDigest: "a".repeat(64) }).decision, "ask");
});

test("session grants do not cover another resource", () => {
  const manager = new PermissionManager([{ capability: "browser", operation: "navigate", resource: "*", mode: "session" }]);
  manager.grantForSession(request);
  assert.equal(manager.evaluate(request).decision, "allow");
  assert.equal(manager.evaluate({ ...request, resource: "other.example" }).decision, "ask");
});

test("more specific deny overrides a broad allow", () => {
  const manager = new PermissionManager([
    { capability: "*", operation: "*", resource: "*", mode: "always" },
    { capability: "browser", operation: "navigate", resource: "example.com", mode: "deny" },
  ]);
  assert.equal(manager.evaluate(request).decision, "deny");
});

test("destructive and privileged actions always require fresh approval", () => {
  const manager = new PermissionManager([{ capability: "files", operation: "delete", resource: "*", mode: "always" }]);
  assert.equal(manager.evaluate({ capability: "files", operation: "delete", resource: "/tmp/x", risk: "destructive" }).decision, "ask");
  assert.equal(manager.evaluate({ capability: "files", operation: "delete", resource: "/tmp/x", requiresElevation: true }).decision, "ask");
});

test("wildcard one-time approvals are rejected", () => {
  const manager = new PermissionManager([{ capability: "browser", operation: "*", resource: "*", mode: "ask" }]);
  assert.throws(() => manager.createApprovalRequest({ capability: "browser", operation: "*", resource: "*" }, "e".repeat(64)));
});

test("one-time approval is bound to the exact action argument digest", () => {
  const manager = new PermissionManager([{ capability: "browser", operation: "type", resource: "example.com", mode: "ask" }]);
  const approval = manager.createApprovalRequest({ capability: "browser", operation: "type", resource: "example.com" }, "a".repeat(64));
  manager.grantOnce({ capability: "browser", operation: "type", resource: "example.com" }, approval);
  assert.equal(manager.evaluate({ capability: "browser", operation: "type", resource: "example.com", argumentDigest: "b".repeat(64) }).decision, "ask");
  assert.equal(manager.evaluate({ capability: "browser", operation: "type", resource: "example.com", argumentDigest: "a".repeat(64) }).decision, "allow");
});

test("one-time approval cannot be granted with a mismatched request tuple", () => {
  const manager = new PermissionManager([{ capability: "browser", operation: "click", resource: "example.com", mode: "ask" }]);
  const approval = manager.createApprovalRequest({ capability: "browser", operation: "click", resource: "example.com" }, "c".repeat(64));
  assert.throws(() => manager.grantOnce({ capability: "browser", operation: "navigate", resource: "example.com" }, approval), /do not match/);
});

test("one-time approval requests expire", () => {
  const manager = new PermissionManager([{ capability: "browser", operation: "click", resource: "example.com", mode: "ask" }]);
  const approval = manager.createApprovalRequest({ capability: "browser", operation: "click", resource: "example.com" }, "d".repeat(64), 1000);
  assert.throws(() => manager.grantOnce({ capability: "browser", operation: "click", resource: "example.com" }, { ...approval, now: 62001 }), /expired/);
});

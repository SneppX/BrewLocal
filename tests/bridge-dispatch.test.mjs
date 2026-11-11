import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { canonicalJson } from "../server/core/canonical-json.mjs";
import { PermissionManager } from "../server/core/permissions.mjs";
import { MemoryNonceStore } from "../server/bridge/nonce-store.mjs";
import { dispatchSignedRequest } from "../server/bridge/dispatch.mjs";
import { sha256Canonical } from "../server/bridge/envelope.mjs";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
let sequence = 0;
const deviceId = "local-device-123";

function signedRequest(overrides = {}) {
  const args = overrides.args ?? {};
  const unsigned = {
    protocolVersion: 1,
    requestId: `f8b7e7b0-5f55-4d12-8d39-3d4d1c86a9${String(++sequence).padStart(2,"0")}`,
    deviceId,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
    nonce: `nonce-with-at-least-22-chars-${sequence}`,
    capability: "system",
    operation: "info",
    resource: "system",
    risk: "read",
    args,
    argsDigest: sha256Canonical(args),
    ...overrides,
  };
  const { signature: _ignored, ...unsignedRequest } = unsigned;
  return { ...unsignedRequest, signature: sign(null, Buffer.from(canonicalJson(unsignedRequest)), privateKey).toString("base64url") };
}

function options(request, permissions, extra = {}) {
  const events = [];
  return {
    servicePublicKey: publicKey,
    deviceId,
    nonceStore: new MemoryNonceStore(),
    permissions,
    adapters: [{ capability: "system", operation: "info", async execute(args) { return { ok: true, args }; } }],
    audit: { async record(event) { events.push(event); } },
    ...extra,
    events,
  };
}

test("local deny policy wins over a valid cloud signature", async () => {
  const request = signedRequest();
  const opts = options(request, new PermissionManager());
  const result = await dispatchSignedRequest(request, opts);
  assert.equal(result.status, "denied");
  assert.equal(opts.events.at(-1).decision, "deny");
});

test("local approval is required before an ask-policy operation executes", async () => {
  const request = signedRequest();
  const permissions = new PermissionManager([{ capability: "system", operation: "info", resource: "system", mode: "ask" }]);
  const denied = options(request, permissions);
  const blocked = await dispatchSignedRequest(request, denied);
  assert.equal(blocked.status, "approval_required");
});

test("approved read operation executes only after local confirmation", async () => {
  const request = signedRequest();
  const permissions = new PermissionManager([{ capability: "system", operation: "info", resource: "system", mode: "ask" }]);
  const opts = options(request, permissions, { requestApproval: async () => true });
  const result = await dispatchSignedRequest(request, opts);
  assert.equal(result.status, "completed");
  assert.deepEqual(result.result, { ok: true, args: {} });
});

test("external operations require fresh confirmation even under an always policy", async () => {
  const request = signedRequest({ risk: "external" });
  const permissions = new PermissionManager([{ capability: "system", operation: "info", resource: "system", mode: "always" }]);
  const opts = options(request, permissions);
  const result = await dispatchSignedRequest(request, opts);
  assert.equal(result.status, "approval_required");
});

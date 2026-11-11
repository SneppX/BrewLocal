import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import { canonicalJson } from "../core/canonical-json.mjs";
import { sha256Canonical } from "./envelope.mjs";
import { verifySignedRequest } from "./envelope.mjs";
import { MemoryNonceStore } from "./nonce-store.mjs";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const deviceId = "device-12345678";

function signedRequest(overrides = {}) {
  const unsigned = {
    protocolVersion: 1,
    requestId: "f8b7e7b0-5f55-4d12-8d39-3d4d1c86a901",
    deviceId,
    issuedAt: 10_000,
    expiresAt: 70_000,
    nonce: "nonce-value-with-at-least-22-chars",
    capability: "system",
    operation: "info",
    resource: "system",
    risk: "read",
    args: {},
    argsDigest: sha256Canonical({}),
    ...overrides,
  };
  const { signature: _ignored, ...unsignedRequest } = unsigned;
  return {
    ...unsignedRequest,
    signature: sign(null, Buffer.from(canonicalJson(unsignedRequest)), privateKey).toString("base64url"),
  };
}

test("verifies a valid signed Ed25519 request", async () => {
  const request = signedRequest();
  const result = await verifySignedRequest(request, publicKey, { now: 20_000, nonceStore: new MemoryNonceStore() });
  assert.equal(result.ok, true);
});

test("rejects replayed nonces", async () => {
  const request = signedRequest();
  const nonceStore = new MemoryNonceStore();
  const options = { now: 20_000, nonceStore };
  assert.equal((await verifySignedRequest(request, publicKey, options)).ok, true);
  assert.deepEqual(await verifySignedRequest(request, publicKey, options), { ok: false, reason: "replay" });
});

test("rejects expired requests before signature dispatch", async () => {
  const result = await verifySignedRequest(signedRequest(), publicKey, { now: 70_000, nonceStore: new MemoryNonceStore() });
  assert.deepEqual(result, { ok: false, reason: "expired" });
});

test("rejects requests whose argument digest does not match", async () => {
  const request = signedRequest({ args: { file: "notes.txt" } });
  const result = await verifySignedRequest(request, publicKey, { now: 20_000, nonceStore: new MemoryNonceStore() });
  assert.deepEqual(result, { ok: false, reason: "digest_mismatch" });
});

test("rejects a request with a modified signed resource", async () => {
  const request = signedRequest();
  request.resource = "other-device";
  const result = await verifySignedRequest(request, publicKey, { now: 20_000, nonceStore: new MemoryNonceStore() });
  assert.deepEqual(result, { ok: false, reason: "invalid_signature" });
});

test("canonical JSON sorts object keys recursively", () => {
  assert.equal(canonicalJson({ z: 1, a: { y: 2, b: 3 } }), '{"a":{"b":3,"y":2},"z":1}');
});

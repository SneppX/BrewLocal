import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import {
  beginStoredDevicePairing,
  createBrewPilotPairingClient,
} from "../server/bridge/device-pairing-client.mjs";

function identityStore() {
  let privateKeyPem = null;
  return {
    async storePrivateKey(value) { privateKeyPem = value; },
    async loadPrivateKey() { return privateKeyPem; },
    async deletePrivateKey() { privateKeyPem = null; },
  };
}

test("starts pairing over HTTPS and sends only the public identity", async () => {
  const { publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  let requestedUrl;
  let requestOptions;
  const fetchImpl = async (url, options) => {
    requestedUrl = url;
    requestOptions = options;
    return {
      ok: true,
      json: async () => ({ pairingCode: "A".repeat(32), expiresAt: Date.now() + 60_000 }),
    };
  };
  const client = createBrewPilotPairingClient({
    cloudBaseUrl: "https://cloud.brewpilot.example",
    fetchImpl,
  });

  const result = await client.beginPairing({ deviceId: "device-0001", publicKeyPem });
  assert.equal(result.pairingCode, "A".repeat(32));
  assert.equal(requestedUrl, "https://cloud.brewpilot.example/v1/device-pairings/begin");
  assert.equal(requestOptions.redirect, "error");
  assert.deepEqual(JSON.parse(requestOptions.body), { deviceId: "device-0001", publicKeyPem });
  assert.equal(requestOptions.body.includes("PRIVATE KEY"), false);
});

test("loads or creates the OS-stored identity and returns only its fingerprint and pairing code", async () => {
  const store = identityStore();
  const fetchImpl = async () => ({
    ok: true,
    json: async () => ({ pairingCode: "B".repeat(32), expiresAt: Date.now() + 60_000 }),
  });
  const result = await beginStoredDevicePairing({
    keyStore: store,
    deviceId: "device-0002",
    cloudBaseUrl: "https://cloud.brewpilot.example",
    fetchImpl,
  });
  assert.equal(result.algorithm, "Ed25519");
  assert.match(result.fingerprint, /^[a-f0-9]{64}$/);
  assert.equal(result.pairingCode, "B".repeat(32));
  assert.equal(JSON.stringify(result).includes("PRIVATE KEY"), false);
  assert.match(await store.loadPrivateKey(), /PRIVATE KEY/);
});

test("rejects insecure remote URLs and URL credentials", () => {
  assert.throws(() => createBrewPilotPairingClient({ cloudBaseUrl: "http://cloud.example" }), /HTTPS/);
  assert.throws(() => createBrewPilotPairingClient({ cloudBaseUrl: "https://user:pass@cloud.example" }), /credentials/);
});

test("fails closed on server errors and malformed or expired responses", async () => {
  const publicKeyPem = generateKeyPairSync("ed25519").publicKey
    .export({ format: "pem", type: "spki" }).toString();
  const serverError = createBrewPilotPairingClient({
    cloudBaseUrl: "https://cloud.example",
    fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
  });
  await assert.rejects(serverError.beginPairing({ deviceId: "device-0001", publicKeyPem }), /rejected/);

  const malformed = createBrewPilotPairingClient({
    cloudBaseUrl: "https://cloud.example",
    fetchImpl: async () => ({ ok: true, json: async () => ({ pairingCode: "bad", expiresAt: Date.now() + 60_000 }) }),
  });
  await assert.rejects(malformed.beginPairing({ deviceId: "device-0001", publicKeyPem }), /invalid or expired/);
});

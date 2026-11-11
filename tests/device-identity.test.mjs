import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, verify } from "node:crypto";
import {
  buildDeviceChallengePayload,
  generateDeviceKeyPair,
  getDevicePublicKeyFingerprint,
  signDeviceChallenge,
} from "../server/bridge/device-identity.mjs";

test("generates an Ed25519 identity with a stable public-key fingerprint", () => {
  const identity = generateDeviceKeyPair();
  assert.equal(identity.algorithm, "Ed25519");
  assert.match(identity.publicKeyPem, /BEGIN PUBLIC KEY/);
  assert.match(identity.privateKeyPem, /BEGIN PRIVATE KEY/);
  assert.match(getDevicePublicKeyFingerprint(identity.publicKeyPem), /^[a-f0-9]{64}$/);
  assert.equal(getDevicePublicKeyFingerprint(identity.publicKeyPem), getDevicePublicKeyFingerprint(identity.publicKeyPem));
});

test("matches the cloud challenge protocol and produces a verifiable signature", () => {
  const identity = generateDeviceKeyPair();
  const input = {
    userId: "user-1",
    deviceId: "device-0001",
    challengeId: "123e4567-e89b-12d3-a456-426614174000",
    nonceHash: createHash("sha256").update("server nonce", "utf8").digest("hex"),
  };
  const payload = buildDeviceChallengePayload(input);
  assert.equal(payload.toString("utf8"), ["BrewPilot Device Challenge v1", input.userId, input.deviceId, input.challengeId, input.nonceHash].join(String.fromCharCode(10)));
  const signature = signDeviceChallenge({ ...input, privateKeyPem: identity.privateKeyPem });
  assert.match(signature, /^[A-Za-z0-9_-]{86}$/);
  assert.equal(verify(null, payload, identity.publicKeyPem, Buffer.from(signature, "base64url")), true);
});

test("rejects newline injection and malformed nonce hashes", () => {
  const nonceHash = "a".repeat(64);
  assert.throws(() => buildDeviceChallengePayload({ userId: "user" + String.fromCharCode(10) + "other", deviceId: "device", challengeId: "challenge", nonceHash }), /single-line/);
  assert.throws(() => buildDeviceChallengePayload({ userId: "user", deviceId: "device", challengeId: "challenge", nonceHash: "A".repeat(64) }), /lowercase SHA-256/);
});

test("rejects non-Ed25519 keys", () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  assert.throws(() => signDeviceChallenge({
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    userId: "user",
    deviceId: "device",
    challengeId: "challenge",
    nonceHash: "a".repeat(64),
  }), /Ed25519/);
});

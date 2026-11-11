import { createHash, generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildDeviceChallengePayload,
  generateDeviceKeyPair,
  getDevicePublicKeyFingerprint,
  signDeviceChallenge,
} from "./device-identity.js";

describe("local device identity", () => {
  it("generates an Ed25519 identity with a stable public-key fingerprint", () => {
    const identity = generateDeviceKeyPair();
    expect(identity.algorithm).toBe("Ed25519");
    expect(identity.publicKeyPem).toContain("BEGIN PUBLIC KEY");
    expect(identity.privateKeyPem).toContain("BEGIN PRIVATE KEY");
    expect(getDevicePublicKeyFingerprint(identity.publicKeyPem)).toMatch(/^[a-f0-9]{64}$/);
    expect(getDevicePublicKeyFingerprint(identity.publicKeyPem)).toBe(getDevicePublicKeyFingerprint(identity.publicKeyPem));
  });

  it("matches the cloud challenge protocol and produces a verifiable signature", () => {
    const identity = generateDeviceKeyPair();
    const input = {
      userId: "user-1",
      deviceId: "device-0001",
      challengeId: "123e4567-e89b-12d3-a456-426614174000",
      nonceHash: createHash("sha256").update("server nonce", "utf8").digest("hex"),
    };
    const payload = buildDeviceChallengePayload(input);
    expect(payload.toString("utf8").split("\n")).toHaveLength(5);
    const signature = signDeviceChallenge({ ...input, privateKeyPem: identity.privateKeyPem });
    expect(signature).toMatch(/^[A-Za-z0-9_-]{86}$/);
    expect(verify(null, payload, identity.publicKeyPem, Buffer.from(signature, "base64url"))).toBe(true);
  });

  it("rejects newline injection and malformed nonce hashes", () => {
    const nonceHash = "a".repeat(64);
    expect(() => buildDeviceChallengePayload({ userId: "user\nother", deviceId: "device", challengeId: "challenge", nonceHash })).toThrow(/single-line/);
    expect(() => buildDeviceChallengePayload({ userId: "user", deviceId: "device", challengeId: "challenge", nonceHash: "A".repeat(64) })).toThrow(/lowercase SHA-256/);
  });

  it("rejects non-Ed25519 keys", () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(() => signDeviceChallenge({
      privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
      userId: "user",
      deviceId: "device",
      challengeId: "challenge",
      nonceHash: "a".repeat(64),
    })).toThrow(/Ed25519/);
  });
});

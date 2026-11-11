import { createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";

const PROTOCOL_PREFIX = "BrewPilot Device Challenge v1";
const SHA256_HEX = /^[a-f0-9]{64}$/;

function requireSingleLine(value, field) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\n") || value.includes("\r")) {
    throw new TypeError(`${field} must be a non-empty single-line string.`);
  }
  return value;
}

export function buildDeviceChallengePayload({ userId, deviceId, challengeId, nonceHash }) {
  const fields = [
    PROTOCOL_PREFIX,
    requireSingleLine(userId, "userId"),
    requireSingleLine(deviceId, "deviceId"),
    requireSingleLine(challengeId, "challengeId"),
    requireSingleLine(nonceHash, "nonceHash"),
  ];
  if (!SHA256_HEX.test(nonceHash)) {
    throw new TypeError("nonceHash must be a lowercase SHA-256 hex digest.");
  }
  return Buffer.from(fields.join("\n"), "utf8");
}

export function generateDeviceKeyPair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return Object.freeze({
    algorithm: "Ed25519",
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  });
}

export function signDeviceChallenge({ privateKeyPem, userId, deviceId, challengeId, nonceHash }) {
  if (typeof privateKeyPem !== "string" || privateKeyPem.length === 0) {
    throw new TypeError("privateKeyPem is required.");
  }
  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("The device private key must use Ed25519.");
  }
  const payload = buildDeviceChallengePayload({ userId, deviceId, challengeId, nonceHash });
  return sign(null, payload, privateKey).toString("base64url");
}

export function getDevicePublicKeyFingerprint(publicKeyPem) {
  if (typeof publicKeyPem !== "string" || publicKeyPem.length === 0) {
    throw new TypeError("publicKeyPem is required.");
  }
  const publicKey = createPublicKey(publicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519") {
    throw new TypeError("The device public key must use Ed25519.");
  }
  return createHash("sha256").update(publicKey.export({ format: "der", type: "spki" })).digest("hex");
}

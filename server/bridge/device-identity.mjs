import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign } from "node:crypto";

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


function requireKeyStore(keyStore) {
  if (!keyStore || typeof keyStore.loadPrivateKey !== "function" || typeof keyStore.storePrivateKey !== "function") {
    throw new TypeError("A compatible OS-backed device key store is required.");
  }
}

export async function createStoredDeviceIdentity({ keyStore } = {}) {
  requireKeyStore(keyStore);
  let privateKeyPem = await keyStore.loadPrivateKey();
  if (privateKeyPem === null) {
    const generated = generateDeviceKeyPair();
    privateKeyPem = generated.privateKeyPem;
    await keyStore.storePrivateKey(privateKeyPem);
  }

  const privateKey = createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519" || privateKey.type !== "private") {
    throw new TypeError("The stored device identity is not a valid Ed25519 private key.");
  }
  const publicKeyPem = createPublicKey(privateKey).export({ format: "pem", type: "spki" }).toString();
  return Object.freeze({
    algorithm: "Ed25519",
    publicKeyPem,
    fingerprint: getDevicePublicKeyFingerprint(publicKeyPem),
  });
}

export async function signStoredDeviceChallenge({ keyStore, userId, deviceId, challengeId, nonceHash } = {}) {
  requireKeyStore(keyStore);
  const privateKeyPem = await keyStore.loadPrivateKey();
  if (privateKeyPem === null) {
    throw new Error("No paired device identity exists in the operating system credential store.");
  }
  return signDeviceChallenge({ privateKeyPem, userId, deviceId, challengeId, nonceHash });
}

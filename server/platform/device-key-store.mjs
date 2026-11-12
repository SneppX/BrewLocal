import { createHash, createPrivateKey } from "node:crypto";
import { getPlatformAdapter } from "./registry.mjs";

const SERVICE_NAME = "com.sneppx.brewpilot.device-identity";
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function validateDeviceId(deviceId) {
  if (typeof deviceId !== "string" || !DEVICE_ID_PATTERN.test(deviceId)) {
    throw new TypeError("deviceId must be 1-200 safe identifier characters.");
  }
  return deviceId;
}

function validatePrivateKey(privateKeyPem) {
  if (typeof privateKeyPem !== "string" || privateKeyPem.length === 0) {
    throw new TypeError("A non-empty Ed25519 private key is required.");
  }
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519" || key.type !== "private") {
    throw new TypeError("Only Ed25519 private keys can be stored.");
  }
  return privateKeyPem;
}

function accountNameForDevice(accountId, deviceId) {
  const scopedIdentity = accountId + String.fromCharCode(0) + deviceId;
  return "device:" + createHash("sha256").update(scopedIdentity, "utf8").digest("hex");
}

function sessionAccountNameForDevice(accountId, deviceId) {
  const scopedIdentity = accountId + String.fromCharCode(0) + deviceId + String.fromCharCode(0) + "session";
  return "session:" + createHash("sha256").update(scopedIdentity, "utf8").digest("hex");
}

function validateSessionRecord(record) {
  if (!record || typeof record !== "object" || !SESSION_TOKEN_PATTERN.test(record.token ?? "") ||
      !Number.isSafeInteger(record.expiresAt) || record.expiresAt <= 0) {
    throw new TypeError("A valid device session token and expiry are required.");
  }
  return { token: record.token, expiresAt: record.expiresAt };
}

function keyringOptions(platform) {
  if (platform === "linux") {
    // Require Secret Service. Automatic selection may fall back to a volatile keyutils keyring.
    return { linux: { store: "secret-service" } };
  }
  return undefined;
}

export async function createDeviceKeyStore({ accountId, deviceId, platform = process.platform, EntryClass } = {}) {
  validateDeviceId(accountId);
  validateDeviceId(deviceId);
  const adapter = getPlatformAdapter(platform);
  if (!adapter.supported) {
    throw new Error("Secure device identity storage is unavailable on this operating system.");
  }

  let NativeEntry = EntryClass;
  if (!NativeEntry) {
    try {
      ({ Entry: NativeEntry } = await import("@napi-rs/keyring"));
    } catch {
      throw new Error("The native OS credential-store provider is unavailable. No plaintext fallback is permitted.");
    }
  }

  let entry;
  let sessionEntry;
  try {
    const options = keyringOptions(adapter.id);
    entry = options
      ? new NativeEntry(SERVICE_NAME, accountNameForDevice(accountId, deviceId), options)
      : new NativeEntry(SERVICE_NAME, accountNameForDevice(accountId, deviceId));
    sessionEntry = options
      ? new NativeEntry(SERVICE_NAME, sessionAccountNameForDevice(accountId, deviceId), options)
      : new NativeEntry(SERVICE_NAME, sessionAccountNameForDevice(accountId, deviceId));
  } catch {
    throw new Error("The operating system credential store could not be opened. No plaintext fallback is permitted.");
  }

  return Object.freeze({
    async storePrivateKey(privateKeyPem) {
      const validated = validatePrivateKey(privateKeyPem);
      try {
        entry.setPassword(validated);
      } catch {
        throw new Error("The operating system credential store rejected the private key.");
      }
    },
    async loadPrivateKey() {
      let value;
      try {
        value = entry.getPassword();
      } catch {
        throw new Error("The operating system credential store could not read the private key.");
      }
      if (value === null || value === undefined) return null;
      return validatePrivateKey(value);
    },
    async deletePrivateKey() {
      try {
        entry.deletePassword();
      } catch {
        throw new Error("The operating system credential store could not delete the private key.");
      }
    },
    async storeSessionToken(record) {
      const validated = validateSessionRecord(record);
      if (validated.expiresAt <= Date.now()) {
        throw new TypeError("An expired device session cannot be stored.");
      }
      try {
        sessionEntry.setPassword(JSON.stringify(validated));
      } catch {
        throw new Error("The operating system credential store rejected the device session.");
      }
    },
    async loadSessionToken() {
      let value;
      try {
        value = sessionEntry.getPassword();
      } catch {
        throw new Error("The operating system credential store could not read the device session.");
      }
      if (value === null || value === undefined) return null;
      let parsed;
      try { parsed = JSON.parse(value); }
      catch {
        throw new Error("The operating system credential store returned an invalid device session.");
      }
      const validated = validateSessionRecord(parsed);
      if (validated.expiresAt <= Date.now()) {
        try { sessionEntry.deletePassword(); } catch {
          throw new Error("The expired device session could not be removed from the credential store.");
        }
        return null;
      }
      return validated;
    },
    async deleteSessionToken() {
      try {
        sessionEntry.deletePassword();
      } catch {
        throw new Error("The operating system credential store could not delete the device session.");
      }
    },
  });
}

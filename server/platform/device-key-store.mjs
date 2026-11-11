import { createHash, createPrivateKey } from "node:crypto";
import { getPlatformAdapter } from "./registry.mjs";

const SERVICE_NAME = "com.sneppx.brewpilot.device-identity";
const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{1,200}$/;

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

function accountNameForDevice(deviceId) {
  return "device:" + createHash("sha256").update(deviceId, "utf8").digest("hex");
}

function keyringOptions(platform) {
  if (platform === "linux") {
    // Require Secret Service. Automatic selection may fall back to a volatile keyutils keyring.
    return { linux: { store: "secret-service" } };
  }
  return undefined;
}

export async function createDeviceKeyStore({ deviceId, platform = process.platform, EntryClass } = {}) {
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
  try {
    const options = keyringOptions(adapter.id);
    entry = options
      ? new NativeEntry(SERVICE_NAME, accountNameForDevice(deviceId), options)
      : new NativeEntry(SERVICE_NAME, accountNameForDevice(deviceId));
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
  });
}

import { createStoredDeviceIdentity } from "./device-identity.mjs";

const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const PAIRING_CODE_PATTERN = /^[A-F0-9]{32}$/;

function normalizeCloudBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TypeError("A valid BrewPilot cloud base URL is required.");
  }
  const localHttp = url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  if (url.protocol !== "https:" && !localHttp) {
    throw new TypeError("BrewPilot pairing requires HTTPS (HTTP is allowed only for loopback development).");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError("The cloud base URL must not contain credentials, a query, or a fragment.");
  }
  return url.origin;
}

export function createBrewPilotPairingClient({
  cloudBaseUrl,
  fetchImpl = fetch,
  timeoutMs = 10_000,
} = {}) {
  const origin = normalizeCloudBaseUrl(cloudBaseUrl);
  if (typeof fetchImpl !== "function") throw new TypeError("A Fetch-compatible implementation is required.");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new TypeError("timeoutMs must be between 1 and 60000.");
  }

  return Object.freeze({
    async beginPairing({ deviceId, publicKeyPem } = {}) {
      if (typeof deviceId !== "string" || !DEVICE_ID_PATTERN.test(deviceId)) {
        throw new TypeError("A valid device ID is required.");
      }
      if (typeof publicKeyPem !== "string" || publicKeyPem.length < 80 || publicKeyPem.length > 1024) {
        throw new TypeError("A valid device public key is required.");
      }

      let response;
      try {
        response = await fetchImpl(origin + "/v1/device-pairings/begin", {
          method: "POST",
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ deviceId, publicKeyPem }),
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        throw new Error("Could not securely contact BrewPilot Cloud. Check the connection and try again.");
      }

      if (!response.ok) {
        throw new Error("BrewPilot Cloud rejected the pairing request.");
      }
      let payload;
      try {
        payload = await response.json();
      } catch {
        throw new Error("BrewPilot Cloud returned an invalid pairing response.");
      }
      if (!payload || typeof payload !== "object" ||
          !PAIRING_CODE_PATTERN.test(payload.pairingCode ?? "") ||
          !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= Date.now()) {
        throw new Error("BrewPilot Cloud returned an invalid or expired pairing response.");
      }
      return Object.freeze({
        pairingCode: payload.pairingCode,
        expiresAt: payload.expiresAt,
      });
    },
  });
}

/**
 * Creates/loads the OS-protected identity and starts cloud enrollment.
 * The private key remains inside the OS credential-store adapter.
 */
export async function beginStoredDevicePairing({
  keyStore,
  deviceId,
  cloudBaseUrl,
  fetchImpl = fetch,
  timeoutMs = 10_000,
} = {}) {
  const identity = await createStoredDeviceIdentity({ keyStore });
  const client = createBrewPilotPairingClient({ cloudBaseUrl, fetchImpl, timeoutMs });
  const pairing = await client.beginPairing({ deviceId, publicKeyPem: identity.publicKeyPem });
  return Object.freeze({
    deviceId,
    algorithm: identity.algorithm,
    fingerprint: identity.fingerprint,
    pairingCode: pairing.pairingCode,
    expiresAt: pairing.expiresAt,
  });
}

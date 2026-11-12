const DEVICE_ID_PATTERN = /^[A-Za-z0-9._:-]{8,128}$/;
const DEVICE_CODE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const USER_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;
const SESSION_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

function normalizeCloudBaseUrl(value) {
  let url;
  try { url = new URL(value); }
  catch { throw new TypeError("A valid BrewPilot cloud base URL is required."); }
  const localHttp = url.protocol === "http:" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]");
  if (url.protocol !== "https:" && !localHttp) {
    throw new TypeError("BrewPilot device authorization requires HTTPS (HTTP is allowed only for loopback development).");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new TypeError("The cloud base URL must not contain credentials, a query, or a fragment.");
  }
  return url.origin;
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new Error("Authorization wait was cancelled."));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(signal.reason ?? new Error("Authorization wait was cancelled."));
    }, { once: true });
  });
}

async function readJson(response) {
  try {
    const value = await response.json();
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

/**
 * Headless device authorization client. The device code stays in this
 * closure; only the short user code is returned for the user to approve.
 * A successful bearer token is persisted immediately through the OS keyring.
 */
export function createBrewPilotDeviceAuthorizationClient({
  cloudBaseUrl,
  deviceId,
  keyStore,
  fetchImpl = fetch,
  timeoutMs = 10_000,
  sleepImpl = delay,
} = {}) {
  const origin = normalizeCloudBaseUrl(cloudBaseUrl);
  if (typeof fetchImpl !== "function") throw new TypeError("A Fetch-compatible implementation is required.");
  if (typeof deviceId !== "string" || !DEVICE_ID_PATTERN.test(deviceId)) {
    throw new TypeError("A valid device ID is required.");
  }
  if (!keyStore || typeof keyStore.storeSessionToken !== "function" ||
      typeof keyStore.loadSessionToken !== "function" || typeof keyStore.deleteSessionToken !== "function") {
    throw new TypeError("An OS-backed session credential store is required.");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60_000) {
    throw new TypeError("timeoutMs must be between 1 and 60000.");
  }

  let activeDeviceCode = null;
  let activeExpiresAt = 0;
  let pollIntervalSeconds = 5;

  async function post(path, body) {
    try {
      return await fetchImpl(origin + path, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body),
        redirect: "error",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new Error("Could not securely contact BrewPilot Cloud. Check the connection and try again.");
    }
  }

  const begin = async () => {
      let response = await post("/v1/device-authorizations/begin", { deviceId });
      if (!response.ok) throw new Error("BrewPilot Cloud could not start device authorization.");
      const payload = await readJson(response);
      if (!payload || !DEVICE_CODE_PATTERN.test(payload.deviceCode ?? "") ||
          !USER_CODE_PATTERN.test(payload.userCode ?? "") ||
          !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= Date.now() ||
          !Number.isSafeInteger(payload.intervalSeconds) || payload.intervalSeconds < 1 || payload.intervalSeconds > 30 ||
          typeof payload.verificationInstructions !== "string") {
        throw new Error("BrewPilot Cloud returned an invalid device authorization response.");
      }
      activeDeviceCode = payload.deviceCode;
      activeExpiresAt = payload.expiresAt;
      pollIntervalSeconds = payload.intervalSeconds;
      return Object.freeze({
        userCode: payload.userCode,
        expiresAt: payload.expiresAt,
        intervalSeconds: payload.intervalSeconds,
        verificationInstructions: payload.verificationInstructions,
      });
  };

  const poll = async () => {
      if (!activeDeviceCode) throw new Error("Start device authorization before polling.");
      if (Date.now() >= activeExpiresAt) {
        activeDeviceCode = null;
        return Object.freeze({ status: "expired" });
      }
      const response = await post("/v1/device-authorizations/token", { deviceCode: activeDeviceCode });
      if (response.status === 202) {
        const pending = await readJson(response);
        const intervalSeconds = Number.isSafeInteger(pending?.intervalSeconds) &&
          pending.intervalSeconds >= 1 && pending.intervalSeconds <= 30
          ? pending.intervalSeconds
          : pollIntervalSeconds;
        pollIntervalSeconds = intervalSeconds;
        return Object.freeze({ status: "authorization_pending", intervalSeconds });
      }
      if (response.status === 410) {
        activeDeviceCode = null;
        return Object.freeze({ status: "expired" });
      }
      if (response.status === 409) {
        activeDeviceCode = null;
        return Object.freeze({ status: "already_used" });
      }
      if (response.status === 429) {
        return Object.freeze({ status: "authorization_pending", intervalSeconds: Math.max(10, pollIntervalSeconds) });
      }
      if (!response.ok) {
        activeDeviceCode = null;
        throw new Error("BrewPilot Cloud rejected the device authorization token request.");
      }
      const payload = await readJson(response);
      if (!payload || typeof payload.sessionId !== "string" ||
          !SESSION_TOKEN_PATTERN.test(payload.token ?? "") ||
          !Number.isSafeInteger(payload.expiresAt) || payload.expiresAt <= Date.now()) {
        activeDeviceCode = null;
        throw new Error("BrewPilot Cloud returned an invalid device session.");
      }
      activeDeviceCode = null;
      await keyStore.storeSessionToken({ token: payload.token, expiresAt: payload.expiresAt });
      return Object.freeze({ status: "authorized", expiresAt: payload.expiresAt });
  };

  const waitForApproval = async ({ onPending, signal } = {}) => {
      if (!activeDeviceCode) await begin();
      while (activeDeviceCode && Date.now() < activeExpiresAt) {
        const result = await poll();
        if (result.status === "authorized" || result.status === "expired" || result.status === "already_used") {
          return result;
        }
        if (typeof onPending === "function") await onPending(result);
        await sleepImpl(result.intervalSeconds * 1000, signal);
      }
      return Object.freeze({ status: "expired" });
  };

  return Object.freeze({
    begin,
    poll,
    waitForApproval,
    async loadSession() { return keyStore.loadSessionToken(); },
    async clearSession() { await keyStore.deleteSessionToken(); },
  });
}

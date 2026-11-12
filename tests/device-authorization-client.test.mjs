import test from "node:test";
import assert from "node:assert/strict";
import { createBrewPilotDeviceAuthorizationClient } from "../server/bridge/device-authorization-client.mjs";

function jsonResponse(status, value) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function makeKeyStore() {
  let session = null;
  return {
    async storeSessionToken(value) { session = value; },
    async loadSessionToken() { return session; },
    async deleteSessionToken() { session = null; },
    getSession() { return session; },
  };
}

function makeBeginPayload() {
  return {
    deviceCode: "D".repeat(43),
    userCode: "ABCD-EFGH",
    expiresAt: Date.now() + 600_000,
    intervalSeconds: 5,
    verificationInstructions: "Use devices_authorize.",
  };
}

test("starts authorization and exposes only the user code, never the device secret", async () => {
  const calls = [];
  const client = createBrewPilotDeviceAuthorizationClient({
    cloudBaseUrl: "https://cloud.example.test",
    deviceId: "device-0001",
    keyStore: makeKeyStore(),
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(201, makeBeginPayload());
    },
  });
  const result = await client.begin();
  assert.equal(result.userCode, "ABCD-EFGH");
  assert.equal(result.intervalSeconds, 5);
  assert.equal("deviceCode" in result, false);
  assert.equal(calls[0].url, "https://cloud.example.test/v1/device-authorizations/begin");
  assert.deepEqual(JSON.parse(calls[0].init.body), { deviceId: "device-0001" });
  assert.equal(calls[0].init.redirect, "error");
});

test("polls pending authorization and stores an approved session in the OS key store", async () => {
  const keyStore = makeKeyStore();
  const responses = [
    jsonResponse(201, makeBeginPayload()),
    jsonResponse(202, { error: "authorization_pending", intervalSeconds: 5 }),
    jsonResponse(200, {
      sessionId: "session-1",
      token: "T".repeat(43),
      expiresAt: Date.now() + 43_200_000,
    }),
  ];
  const calls = [];
  const client = createBrewPilotDeviceAuthorizationClient({
    cloudBaseUrl: "https://cloud.example.test",
    deviceId: "device-0001",
    keyStore,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return responses.shift();
    },
  });
  await client.begin();
  assert.equal(await client.loadSession(), null);
  assert.deepEqual(await client.poll(), { status: "authorization_pending", intervalSeconds: 5 });
  const authorized = await client.poll();
  assert.equal(authorized.status, "authorized");
  assert.deepEqual(await client.loadSession(), keyStore.getSession());
  assert.equal(keyStore.getSession().token, "T".repeat(43));
  assert.equal(JSON.parse(calls[2].init.body).deviceCode, "D".repeat(43));
});

test("waits at the server-provided interval until approval and persists the session", async () => {
  const keyStore = makeKeyStore();
  const responses = [
    jsonResponse(201, makeBeginPayload()),
    jsonResponse(202, { error: "authorization_pending", intervalSeconds: 2 }),
    jsonResponse(200, {
      sessionId: "session-2",
      token: "U".repeat(43),
      expiresAt: Date.now() + 43_200_000,
    }),
  ];
  const pending = [];
  const delays = [];
  const client = createBrewPilotDeviceAuthorizationClient({
    cloudBaseUrl: "https://cloud.example.test",
    deviceId: "device-0002",
    keyStore,
    fetchImpl: async () => responses.shift(),
    sleepImpl: async (ms) => { delays.push(ms); },
  });
  const started = await client.begin();
  assert.equal(started.userCode, "ABCD-EFGH");
  const result = await client.waitForApproval({ onPending: (value) => pending.push(value) });
  assert.equal(result.status, "authorized");
  assert.deepEqual(delays, [2000]);
  assert.equal(pending.length, 1);
  assert.equal(keyStore.getSession().token, "U".repeat(43));
});

test("never stores an invalid session response", async () => {
  const keyStore = makeKeyStore();
  const client = createBrewPilotDeviceAuthorizationClient({
    cloudBaseUrl: "https://cloud.example.test",
    deviceId: "device-0003",
    keyStore,
    fetchImpl: async (url) => url.endsWith("/begin")
      ? jsonResponse(201, makeBeginPayload())
      : jsonResponse(200, { sessionId: "session-3", token: "bad", expiresAt: Date.now() + 60_000 }),
  });
  await client.begin();
  await assert.rejects(client.poll(), /invalid device session/);
  assert.equal(keyStore.getSession(), null);
});

test("rejects insecure cloud URLs, invalid device IDs, and missing OS key stores", () => {
  const keyStore = makeKeyStore();
  assert.throws(() => createBrewPilotDeviceAuthorizationClient({
    cloudBaseUrl: "http://cloud.example.test", deviceId: "device-0001", keyStore,
  }), /requires HTTPS/);
  assert.throws(() => createBrewPilotDeviceAuthorizationClient({
    cloudBaseUrl: "https://cloud.example.test", deviceId: "bad id", keyStore,
  }), /valid device ID/);
  assert.throws(() => createBrewPilotDeviceAuthorizationClient({
    cloudBaseUrl: "https://cloud.example.test", deviceId: "device-0001",
  }), /OS-backed session credential store/);
});

test("requires begin before polling and supports clearing the stored session", async () => {
  const keyStore = makeKeyStore();
  const client = createBrewPilotDeviceAuthorizationClient({
    cloudBaseUrl: "https://cloud.example.test",
    deviceId: "device-0004",
    keyStore,
    fetchImpl: async () => jsonResponse(201, makeBeginPayload()),
  });
  await assert.rejects(client.poll(), /Start device authorization/);
  await client.begin();
  await client.clearSession();
  assert.equal(await client.loadSession(), null);
});

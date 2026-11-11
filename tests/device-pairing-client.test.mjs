import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
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

describe("BrewPilot pairing client", () => {
  it("starts pairing over HTTPS and sends only the public identity", async () => {
    const { publicKey } = generateKeyPairSync("ed25519");
    const publicKeyPem = publicKey.export({ format: "pem", type: "spki" }).toString();
    const fetchImpl = vi.fn(async (_url, options) => ({
      ok: true,
      json: async () => ({ pairingCode: "A".repeat(32), expiresAt: Date.now() + 60_000 }),
      requestOptions: options,
    }));
    const client = createBrewPilotPairingClient({
      cloudBaseUrl: "https://cloud.brewpilot.example",
      fetchImpl,
    });

    const result = await client.beginPairing({ deviceId: "device-0001", publicKeyPem });
    expect(result.pairingCode).toBe("A".repeat(32));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, options] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://cloud.brewpilot.example/v1/device-pairings/begin");
    expect(options.redirect).toBe("error");
    expect(JSON.parse(options.body)).toEqual({ deviceId: "device-0001", publicKeyPem });
    expect(options.body).not.toContain("PRIVATE KEY");
  });

  it("loads or creates the OS-stored identity and returns only its fingerprint and pairing code", async () => {
    const store = identityStore();
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ pairingCode: "B".repeat(32), expiresAt: Date.now() + 60_000 }),
    }));
    const result = await beginStoredDevicePairing({
      keyStore: store,
      deviceId: "device-0002",
      cloudBaseUrl: "https://cloud.brewpilot.example",
      fetchImpl,
    });
    expect(result.algorithm).toBe("Ed25519");
    expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.pairingCode).toBe("B".repeat(32));
    expect(JSON.stringify(result)).not.toContain("PRIVATE KEY");
    expect(await store.loadPrivateKey()).toContain("PRIVATE KEY");
  });

  it("rejects insecure remote URLs, URL credentials, and redirects", () => {
    expect(() => createBrewPilotPairingClient({ cloudBaseUrl: "http://cloud.example" }))
      .toThrow(/HTTPS/);
    expect(() => createBrewPilotPairingClient({ cloudBaseUrl: "https://user:pass@cloud.example" }))
      .toThrow(/credentials/);
  });

  it("fails closed on server errors and malformed or expired responses", async () => {
    const publicKeyPem = generateKeyPairSync("ed25519").publicKey
      .export({ format: "pem", type: "spki" }).toString();
    const serverError = createBrewPilotPairingClient({
      cloudBaseUrl: "https://cloud.example",
      fetchImpl: async () => ({ ok: false, json: async () => ({}) }),
    });
    await expect(serverError.beginPairing({ deviceId: "device-0001", publicKeyPem }))
      .rejects.toThrow(/rejected/);

    const malformed = createBrewPilotPairingClient({
      cloudBaseUrl: "https://cloud.example",
      fetchImpl: async () => ({ ok: true, json: async () => ({ pairingCode: "bad", expiresAt: Date.now() + 60_000 }) }),
    });
    await expect(malformed.beginPairing({ deviceId: "device-0001", publicKeyPem }))
      .rejects.toThrow(/invalid or expired/);
  });
});

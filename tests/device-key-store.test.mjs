import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createDeviceKeyStore } from "../server/platform/device-key-store.mjs";

function makeIdentity() {
  const { privateKey } = generateKeyPairSync("ed25519");
  return privateKey.export({ format: "pem", type: "pkcs8" }).toString();
}

function makeEntryHarness() {
  const records = new Map();
  class FakeEntry {
    constructor(service, account, options) {
      this.key = service + ":" + account;
      this.options = options;
    }
    setPassword(value) { records.set(this.key, value); }
    getPassword() { return records.get(this.key) ?? null; }
    deletePassword() { records.delete(this.key); }
  }
  return { FakeEntry, records };
}

test("stores and retrieves Ed25519 private keys through the injected native provider", async () => {
  const { FakeEntry, records } = makeEntryHarness();
  const store = await createDeviceKeyStore({ deviceId: "device-01", platform: "win32", EntryClass: FakeEntry });
  const privateKeyPem = makeIdentity();
  await store.storePrivateKey(privateKeyPem);
  assert.equal(await store.loadPrivateKey(), privateKeyPem);
  assert.equal(records.size, 1);
  await store.deletePrivateKey();
  assert.equal(await store.loadPrivateKey(), null);
});

test("requires the Linux Secret Service backend explicitly", async () => {
  const { FakeEntry } = makeEntryHarness();
  let capturedOptions;
  class InspectingEntry extends FakeEntry {
    constructor(service, account, options) {
      super(service, account, options);
      capturedOptions = options;
    }
  }
  await createDeviceKeyStore({ deviceId: "device-02", platform: "linux", EntryClass: InspectingEntry });
  assert.deepEqual(capturedOptions, { linux: { store: "secret-service" } });
});

test("rejects unsupported operating systems without creating a provider", async () => {
  let constructed = false;
  class ForbiddenEntry {
    constructor() { constructed = true; }
  }
  await assert.rejects(
    createDeviceKeyStore({ deviceId: "device-03", platform: "plan9", EntryClass: ForbiddenEntry }),
    /unavailable on this operating system/,
  );
  assert.equal(constructed, false);
});

test("rejects malformed identifiers and non-Ed25519 keys", async () => {
  const { FakeEntry } = makeEntryHarness();
  await assert.rejects(
    createDeviceKeyStore({ deviceId: "device" + String.fromCharCode(10) + "malicious", platform: "win32", EntryClass: FakeEntry }),
    /safe identifier/,
  );
  const store = await createDeviceKeyStore({ deviceId: "device-04", platform: "darwin", EntryClass: FakeEntry });
  await assert.rejects(store.storePrivateKey("not a private key"), /Invalid PEM|DECODER|private key/i);
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  await assert.rejects(
    store.storePrivateKey(privateKey.export({ format: "pem", type: "pkcs8" }).toString()),
    /Only Ed25519/,
  );
});

test("fails closed when the native keyring provider is unavailable", async () => {
  await assert.rejects(
    createDeviceKeyStore({
      deviceId: "device-05",
      platform: "linux",
      EntryClass: class { constructor() { throw new Error("no keyring"); } },
    }),
    /No plaintext fallback/,
  );
});

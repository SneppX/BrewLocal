import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { generateDeviceKeyPair } from "../server/bridge/device-identity.mjs";
import { createDeviceKeyStore } from "../server/platform/device-key-store.mjs";

const suffix = randomUUID();
const keyStore = await createDeviceKeyStore({
  accountId: "brewpilot-ci-" + suffix,
  deviceId: "brewpilot-ci-" + suffix,
});

const identity = generateDeviceKeyPair();
try {
  await keyStore.storePrivateKey(identity.privateKeyPem);
  const restored = await keyStore.loadPrivateKey();
  assert.equal(restored, identity.privateKeyPem, "native credential store must return the exact private key");
  await keyStore.deletePrivateKey();
  assert.equal(await keyStore.loadPrivateKey(), null, "deleted credentials must not remain readable");

  const session = { token: "S".repeat(43), expiresAt: Date.now() + 60_000 };
  await keyStore.storeSessionToken(session);
  assert.deepEqual(await keyStore.loadSessionToken(), session, "native credential store must persist device sessions");
  await keyStore.deleteSessionToken();
  assert.equal(await keyStore.loadSessionToken(), null, "deleted sessions must not remain readable");

  process.stdout.write("Native OS credential-store round-trip passed.\n");
} finally {
  await keyStore.deletePrivateKey().catch(() => {});
  await keyStore.deleteSessionToken().catch(() => {});
}

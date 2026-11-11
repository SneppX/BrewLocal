import test from "node:test";
import assert from "node:assert/strict";
import { getPlatformAdapter, listSupportedPlatforms } from "../server/platform/registry.mjs";

test("all target desktop operating systems have explicit adapters", () => {
  assert.deepEqual(
    listSupportedPlatforms().map((platform) => platform.id).sort(),
    ["linux", "macos", "windows"],
  );
});

test("Windows uses its platform path convention", () => {
  assert.equal(getPlatformAdapter("win32").pathFlavor, "windows");
});

test("macOS and Linux use POSIX path conventions", () => {
  assert.equal(getPlatformAdapter("darwin").pathFlavor, "posix");
  assert.equal(getPlatformAdapter("linux").pathFlavor, "posix");
});

test("unknown operating systems fail closed as unsupported", () => {
  const adapter = getPlatformAdapter("plan9");
  assert.equal(adapter.supported, false);
  assert.equal(adapter.id, "unsupported");
});

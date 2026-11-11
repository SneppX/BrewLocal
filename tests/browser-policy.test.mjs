import test from "node:test";
import assert from "node:assert/strict";
import { BROWSER_OPERATION_POLICY as policy } from "../server/core/browser-policy.mjs";
import { RiskLevel } from "../server/core/permissions.mjs";

test("browser actions that can change remote state always require fresh confirmation", () => {
  for (const name of ["browser_click", "browser_type", "browser_fill"]) {
    assert.equal(policy[name].risk, RiskLevel.EXTERNAL, name);
  }
});

test("browser observation and navigation helpers do not use the remote-mutation risk class", () => {
  for (const name of ["browser_inspect", "browser_scroll", "browser_screenshot", "browser_extract", "browser_tabs", "browser_wait"]) {
    assert.equal(policy[name].risk, RiskLevel.READ, name);
  }
});

test("every exposed browser tool has an explicit policy entry", () => {
  assert.deepEqual(Object.keys(policy).sort(), [
    "browser_click", "browser_extract", "browser_fill", "browser_inspect",
    "browser_screenshot", "browser_scroll", "browser_tabs", "browser_type", "browser_wait",
  ]);
});

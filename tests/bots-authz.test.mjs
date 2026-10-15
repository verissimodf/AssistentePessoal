// Bots get explicit, least-privilege scopes; cli_agent always needs human approval.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.JARVIS_DATA_DIR = mkdtempSync(join(tmpdir(), "jarvis-bots-"));
const { db } = await import("../server/db.js");
const { botPrincipal } = await import("../server/bots.js");
const { callTool } = await import("../server/tools.js");
const { updateSettings } = await import("../server/settings.js");
const { LEGACY_BOT_SCOPES, createAuth } = await import("../server/auth.js");
// Real admin principal issued by the authentication flow (no synthetic admin objects).
const auth = createAuth(db, { dataDir: process.env.JARVIS_DATA_DIR });
auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: "senha-muito-forte-1" });
const ADMIN = auth.validateSession(auth.login({ username: "ana", password: "senha-muito-forte-1", ip: "127.0.0.1" }).sid);

updateSettings({ host: { enabled: true, allowlist: "echo" }, integrations: { claude_code: { enabled: true, command: "echo {prompt}" } } });
const approvals = () => db.prepare("SELECT COUNT(*) n FROM approvals").get().n;
const ctx = (bot, autonomy = "full") => ({ autonomy, pending: [], principal: botPrincipal(bot) });

test("bot principal never carries the wildcard scope", () => {
  for (const b of [{ id: "a" }, { id: "b", scopes: [] }, { id: "c", scopes: ["*", "approvals:resolve", "host:run"] }]) {
    assert.equal(botPrincipal(b).scopes.includes("*"), false);
    assert.equal(botPrincipal(b).scopes.includes("approvals:resolve"), false);
  }
});

test("legacy unowned bot without explicit scopes gets only the restricted compatibility policy", () => {
  const p = botPrincipal({ id: "legacy" });
  assert.equal(p.legacy, true);
  assert.deepEqual(p.scopes, LEGACY_BOT_SCOPES);
});

test("bot without host:run cannot run commands, even in full autonomy", async () => {
  const before = approvals();
  const out = await callTool("run_command", { command: "echo pwned" }, ctx({ id: "b1", scopes: ["web", "comms:send"] }));
  assert.match(out, /Permissão negada.*host:run/);
  assert.equal(approvals(), before);
});

test("bot without comms:send cannot send messages", async () => {
  const out = await callTool("send_message", { channel: "telegram", text: "oi" }, ctx({ id: "b2", scopes: ["web", "host:run"] }));
  assert.match(out, /Permissão negada.*comms:send/);
});

test("legacy bot cannot run commands or send messages", async () => {
  assert.match(await callTool("run_command", { command: "echo x" }, ctx({ id: "legacy" })), /Permissão negada/);
  assert.match(await callTool("send_message", { channel: "telegram", text: "x" }, ctx({ id: "legacy" })), /Permissão negada/);
});

for (const autonomy of ["safe", "full"]) {
  test(`cli_agent in ${autonomy} mode is queued for human approval, never executed directly`, async () => {
    const c = { autonomy, pending: [], principal: ADMIN };
    const before = approvals();
    const out = await callTool("cli_agent", { agent: "claude_code", prompt: "faça algo" }, c);
    assert.match(out, /aprovação/);
    assert.equal(c.pending.length, 1);
    assert.equal(approvals(), before + 1);
    assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(c.pending[0].id).status, "pending");
  });
}

test("cli_agent is refused when host actions are disabled", async () => {
  updateSettings({ host: { enabled: false } });
  const c = { autonomy: "full", pending: [], principal: ADMIN };
  assert.match(await callTool("cli_agent", { agent: "claude_code", prompt: "x" }, c), /desabilitadas/);
  assert.equal(c.pending.length, 0);
  updateSettings({ host: { enabled: true } });
});

test("forged admin object cannot use cli_agent or run_command", async () => {
  const c = { autonomy: "full", pending: [], principal: { type: "admin", adminId: ADMIN.adminId, scopes: ["*"] } };
  assert.match(await callTool("cli_agent", { agent: "claude_code", prompt: "x" }, c), /Permissão negada/);
  assert.match(await callTool("run_command", { command: "echo x" }, c), /Permissão negada/);
  assert.equal(c.pending.length, 0);
});

// Phase 2 review fixes: audit without private content, approvals 404 + at-most-once,
// legacy bots blocked+audited at every entry point, safe legacy claims (runs/approvals).
// Temporary data dir + synthetic data only.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-fix-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
const { createApp } = await import("../server/index.js");
const { auth, db, bots, sanitizeAudit, audit } = await import("../server/db.js");
const { callTool } = await import("../server/tools.js");
const { runBot, triggerByText } = await import("../server/bots.js");
const { ownerOf, assignNew } = await import("../server/ownership.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const SECRET = "TOKEN_SECRETO_SINTETICO_98765";
let server, base;
const A = {}, B = {};
const req = (path, { method = "GET", body, s } = {}) =>
  fetch(base + path, {
    method,
    headers: { origin: ORIGIN, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(s ? { cookie: s.cookie, "x-jarvis-csrf": s.csrf } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
async function login(u, t) {
  const r = await req("/api/auth/login", { method: "POST", body: { username: u, password: PW } });
  const j = await r.json();
  Object.assign(t, { cookie: r.headers.get("set-cookie").split(";")[0], csrf: j.csrf, id: j.admin.id });
  t.principal = auth.validateSession(t.cookie.split("=")[1]);
}
const auditRows = () => db.prepare("SELECT kind, detail FROM audit").all();
const auditText = () => auditRows().map((r) => `${r.kind} ${r.detail}`).join("\n");
const hostOn = (on, s = A) => req("/api/settings", { method: "PUT", body: { host: { enabled: on, allowlist: "echo" } }, s });

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  await login("ana", A);
  await req("/api/auth/admins", { method: "POST", body: { username: "bia", password: PW, currentPassword: PW }, s: A });
  await login("bia", B);
});
after(() => server.close());

// 1 — audit
test("audit allowlist drops any non-metadata field (command, text, path, objects)", () => {
  const d = sanitizeAudit({ command: SECRET, text: SECRET, reason: `x: "${SECRET} com espaço"`, ctx: { a: SECRET }, bot: "b1", scopes: ["web", `${SECRET} !`] });
  assert.deepEqual(d, { bot: "b1", scopes: ["web"], dropped: 4 });
  audit("t", { command: SECRET });
  assert.equal(auditText().includes(SECRET), false);
});

test("synthetic secret in commands, prompts, chat and bot triggers never reaches audit (DB and HTTP)", async () => {
  await hostOn(true);
  const c = { autonomy: "confirm", pending: [], principal: A.principal };
  await callTool("run_command", { command: `echo ${SECRET}` }, c);
  await callTool("cli_agent", { agent: "codex", prompt: SECRET }, c);
  const full = { autonomy: "full", pending: [], principal: A.principal };
  await callTool("run_command", { command: `echo ${SECRET}` }, full);
  const bot = await (await req("/api/bots", { method: "POST", body: { name: "t", goal: "g", enabled: true, trigger_type: "message", trigger_value: "dispara" }, s: A })).json();
  assert.ok(bot.id);
  bots.save({ id: "legmsg", name: "L", goal: "g", enabled: true, trigger_type: "message", trigger_value: "dispara" });
  triggerByText("message", `dispara ${SECRET}`, A.id).forEach((p) => p.catch(() => {}));
  await new Promise((r) => setTimeout(r, 50));
  for (const p of c.pending) await req(`/api/approvals/${p.id}`, { method: "POST", body: { approve: true }, s: A });
  assert.equal(auditText().includes(SECRET), false, "audit table");
  const http = await (await req("/api/audit", { s: B })).text();
  assert.equal(http.includes(SECRET), false, "audit HTTP response");
  assert.ok(auditRows().some((r) => r.kind === "run_command(requested)" && /approvalId/.test(r.detail)));
  await hostOn(false);
});

// 2 — approvals
test("approvals: foreign, legacy and unknown ids → 404; owner resolves once (concurrent)", async () => {
  await hostOn(true);
  const c = { autonomy: "confirm", pending: [], principal: A.principal };
  await callTool("run_command", { command: "echo corrida" }, c);
  const id = c.pending[0].id;
  db.prepare("INSERT INTO approvals (id, command, status, created_at) VALUES ('leg-ap', 'echo x', 'pending', '2025')").run();
  for (const [path, s] of [[id, B], ["leg-ap", A], ["nada", A]]) {
    const r = await req(`/api/approvals/${path}`, { method: "POST", body: { approve: true }, s });
    assert.equal(r.status, 404, path);
    assert.deepEqual(await r.json(), { error: "not_found" });
  }
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "pending");
  const before = auditRows().filter((r) => r.kind === "run_command(approved)").length;
  const rs = await Promise.all([1, 2, 3].map(() => req(`/api/approvals/${id}`, { method: "POST", body: { approve: true }, s: A })));
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409, 409]);
  assert.equal(auditRows().filter((r) => r.kind === "run_command(approved)").length - before, 1, "executed exactly once");
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "done");
  await hostOn(false);
});

test("approvals: approving with host disabled consumes it as denied, never executes later", async () => {
  await hostOn(true);
  const c = { autonomy: "confirm", pending: [], principal: A.principal };
  await callTool("run_command", { command: "echo depois" }, c);
  await hostOn(false);
  const id = c.pending[0].id;
  assert.equal((await req(`/api/approvals/${id}`, { method: "POST", body: { approve: true }, s: A })).status, 200);
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "denied");
  await hostOn(true);
  assert.equal((await req(`/api/approvals/${id}`, { method: "POST", body: { approve: true }, s: A })).status, 409);
  await hostOn(false);
});

// 3 — legacy bots
test("legacy bot: manual route, message trigger and scheduler are blocked and audited (no content)", async () => {
  bots.save({ id: "legbot", name: "Leg", goal: SECRET, enabled: true, trigger_type: "voice", trigger_value: "abracadabra" });
  const count = () => auditRows().filter((r) => r.kind === "authz.bot_denied" && r.detail.includes('"legbot"')).map((r) => JSON.parse(r.detail));
  // manual
  const r = await req("/api/bots/legbot/run", { method: "POST", body: {}, s: A });
  assert.equal(r.status, 404);
  assert.deepEqual(await r.json(), { error: "not_found" }, "same answer as an unknown bot");
  assert.equal((await req("/api/bots/nao-existe/run", { method: "POST", body: {}, s: A })).status, 404);
  assert.deepEqual(count().at(-1), { bot: "legbot", reason: "legacy_blocked", trigger_type: "manual" });
  // text / voice
  assert.equal(triggerByText("voice", `abracadabra ${SECRET}`, B.id).length, 0);
  assert.deepEqual(count().at(-1), { bot: "legbot", reason: "legacy_blocked", trigger_type: "voice" });
  // scheduler path (firing time → runBot with the trigger type)
  const res = await runBot(bots.get("legbot"), "agenda 08:00", "daily");
  assert.equal(res.status, "denied");
  assert.deepEqual(count().at(-1), { bot: "legbot", reason: "legacy_blocked", trigger_type: "daily" });
  assert.equal(db.prepare("SELECT COUNT(*) n FROM runs WHERE bot_id='legbot'").get().n, 0, "never executed");
  assert.equal(auditText().includes(SECRET), false);
  assert.equal(auditText().includes("abracadabra"), false);
});

// 4 — legacy claims
test("claim: a run of a bot owned by another admin cannot be claimed; mixed list rolls back fully", async () => {
  bots.save({ id: "botA", name: "A", goal: "g", enabled: false });
  assignNew("bot", "botA", A.id);
  db.prepare("INSERT INTO runs (id, bot_id, started_at, status, output) VALUES ('runA', 'botA', '2025', 'done', '')").run();
  db.prepare("INSERT INTO runs (id, bot_id, started_at, status, output) VALUES ('runFree', 'sumiu', '2025', 'done', '')").run();
  const claim = (body, s) => req("/api/legacy/claim", { method: "POST", body: { confirm: "ASSUMIR", ...body }, s });
  const r = await claim({ type: "run", ids: ["runFree", "runA"] }, B);
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, "foreign_bot_run");
  assert.equal(ownerOf("run", "runFree"), null, "no partial assignment");
  assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_claims WHERE resource_id IN ('runFree','runA')").get().n, 0);
  assert.equal((await claim({ type: "run", ids: ["runA"] }, A)).status, 200, "the bot owner can claim it");
  assert.equal(ownerOf("run", "runA"), A.id);
});

test("claim: legacy pending approvals are invalidated (legacy_expired), history kept, never executable", async () => {
  await hostOn(true);
  db.prepare("INSERT INTO approvals (id, command, status, created_at) VALUES ('oldap', 'echo antigo', 'pending', '2025-01-01')").run();
  db.prepare("INSERT INTO approvals (id, command, status, created_at) VALUES ('oldap2', 'echo antigo2', 'pending', '2025-01-01')").run();
  // mixed list with an unknown id → full rollback, nothing expired
  const bad = await req("/api/legacy/claim", { method: "POST", body: { type: "approval", ids: ["oldap", "nao-existe"], confirm: "ASSUMIR" }, s: A });
  assert.equal(bad.status, 404);
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id='oldap'").get().status, "pending");
  assert.equal(ownerOf("approval", "oldap"), null);
  const ok = await (await req("/api/legacy/claim", { method: "POST", body: { type: "approval", ids: ["oldap", "oldap2"], confirm: "ASSUMIR" }, s: A })).json();
  assert.equal(ok.expired, 2);
  const row = db.prepare("SELECT command, status, created_at FROM approvals WHERE id='oldap'").get();
  assert.deepEqual({ ...row }, { command: "echo antigo", status: "legacy_expired", created_at: "2025-01-01" });
  const before = auditRows().filter((r) => r.kind === "run_command(approved)").length;
  assert.equal((await req("/api/approvals/oldap", { method: "POST", body: { approve: true }, s: A })).status, 409);
  assert.equal(auditRows().filter((r) => r.kind === "run_command(approved)").length, before, "not executed");
  assert.ok(auditRows().some((r) => r.kind === "legacy.approvals_expired" && r.detail.includes("oldap2")));
  await hostOn(false);
});

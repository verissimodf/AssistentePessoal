// Phase 2 final fix: synthetic probe TOKEN_SECRETO_SONDA in path, backup, token, reason and agent,
// route rejections and the v2 migration report must never reach the audit (DB nor GET /api/audit).
// Temporary data dir (its name contains the probe, so the physical backup path contains it too).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, MIGRATIONS } from "../server/migrations.js";

const PROBE = "TOKEN_SECRETO_SONDA";
const dir = mkdtempSync(join(tmpdir(), `jarvis-${PROBE}-`));
{
  const v1 = new DatabaseSync(join(dir, "jarvis.db"));
  v1.exec(`
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE memories (id TEXT PRIMARY KEY, content TEXT NOT NULL, tags TEXT DEFAULT '', embedding TEXT, created_at TEXT NOT NULL);
CREATE TABLE agents (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE bots (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE runs (id TEXT PRIMARY KEY, bot_id TEXT, started_at TEXT, status TEXT, output TEXT);
CREATE TABLE approvals (id TEXT PRIMARY KEY, command TEXT, status TEXT, output TEXT, created_at TEXT);
CREATE TABLE audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, kind TEXT, detail TEXT);`);
  migrate(v1, dir, { migrations: MIGRATIONS.filter((m) => m.version === 1) });
  v1.exec("INSERT INTO memories VALUES ('m1','x','',NULL,'2026-01-01')");
  v1.close();
}
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
const { createApp } = await import("../server/index.js");
const { auth, db, sanitizeAudit, audit } = await import("../server/db.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const UUID = "3f2b8c1e-9a4d-4b7e-8c2f-1d5e6a7b8c9d";
let server, base;
const A = {};
const req = (path, { method = "GET", body, s, csrf = true } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(s ? { cookie: s.cookie, ...(csrf ? { "x-jarvis-csrf": s.csrf } : {}) } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const rows = () => db.prepare("SELECT kind, detail FROM audit").all();
const dbText = () =>
  rows()
    .map((r) => `${r.kind} ${r.detail}`)
    .join("\n");
const httpText = async () => (await req("/api/audit", { s: A })).text();

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username: "ana", password: PW },
  });
  const j = await r.json();
  Object.assign(A, { cookie: r.headers.get("set-cookie").split(";")[0], csrf: j.csrf });
});
after(() => server.close());

test("path, backup and token are not audit fields", () => {
  const d = sanitizeAudit({ path: "/api/x", backup: "/tmp/b.db", token: "abc", bot: "b1" });
  assert.deepEqual(d, { bot: "b1", dropped: 3 });
});

test("reason accepts only known codes; agent only canonical names or UUID v4", () => {
  assert.deepEqual(sanitizeAudit({ reason: "legacy_blocked", agent: "codex" }), {
    reason: "legacy_blocked",
    agent: "codex",
  });
  assert.deepEqual(sanitizeAudit({ agent: UUID }), { agent: UUID });
  for (const bad of [
    PROBE,
    "sk-ant-api03-abc",
    "ghp_abc123",
    "3f2b8c1e-9a4d-1b7e-8c2f-1d5e6a7b8c9d",
  ]) {
    assert.deepEqual(sanitizeAudit({ reason: bad, agent: bad }), { dropped: 2 }, bad);
  }
});

test("probe in path/backup/token/reason/agent never reaches DB nor GET /api/audit", async () => {
  audit("probe.direct", {
    path: `/api/${PROBE}`,
    backup: `/tmp/${PROBE}.db`,
    token: PROBE,
    reason: PROBE,
    agent: PROBE,
    admin: "ana",
  });
  assert.equal(dbText().includes(PROBE), false, "audit table");
  assert.equal((await httpText()).includes(PROBE), false, "audit HTTP");
  const row = rows().find((r) => r.kind === "probe.direct");
  assert.deepEqual(JSON.parse(row.detail), { admin: "ana", dropped: 5 });
});

test("CSRF route rejection audits only the static route pattern, never url.pathname/query", async () => {
  const r = await req(`/api/memories/${PROBE}?k=${PROBE}`, { method: "DELETE", s: A, csrf: false });
  assert.equal(r.status, 403);
  const row = rows()
    .filter((x) => x.kind === "authz.csrf_rejected")
    .at(-1);
  assert.deepEqual(JSON.parse(row.detail), { route: "/api/memories/:id" });
  assert.equal(dbText().includes(PROBE), false, "audit table");
  assert.equal((await httpText()).includes(PROBE), false, "audit HTTP");
});

test("authz.denied event keeps static route, drops dynamic path", () => {
  audit("authz.denied", {
    route: "/api/memories/:id",
    path: `/api/memories/${PROBE}`,
    need: "memories:write",
    principal: "mcp",
  });
  const row = rows()
    .filter((x) => x.kind === "authz.denied")
    .at(-1);
  assert.deepEqual(JSON.parse(row.detail), {
    route: "/api/memories/:id",
    need: "memories:write",
    principal: "mcp",
    dropped: 1,
  });
  assert.deepEqual(sanitizeAudit({ route: `/api/memories/${PROBE}?x=1` }), { dropped: 1 });
});

test("migration.v2_report records versions, backup_verified and counts — never the backup path", async () => {
  const row = rows().find((r) => r.kind === "migration.v2_report");
  assert.ok(row, "report written");
  const d = JSON.parse(row.detail);
  assert.equal(d.backup_verified, true);
  assert.equal(d.from, 1);
  assert.equal(d.to >= 2, true);
  assert.equal(d.report.memory.total, 1);
  assert.equal("backup" in d || "dropped" in d, false);
  assert.equal(row.detail.includes(dir), false);
  assert.equal(dbText().includes(PROBE), false, "audit table");
  assert.equal((await httpText()).includes(PROBE), false, "audit HTTP");
});

test("real HTTP authz.denied: scoped token hitting a protected route with the probe in path and query", async () => {
  const t = await (
    await req("/api/auth/tokens", {
      method: "POST",
      s: A,
      body: { name: "sonda", scopes: ["memories:read"] },
    })
  ).json();
  assert.ok(t.token, "token issued");
  const before = rows().filter((x) => x.kind === "authz.denied").length;
  const r = await fetch(`${base}/api/memories/${PROBE}?probe=${PROBE}&${PROBE}=1`, {
    method: "DELETE",
    headers: { origin: ORIGIN, authorization: `Bearer ${t.token}` },
  });
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { error: "forbidden", need: "memories:write" });
  const denied = rows().filter((x) => x.kind === "authz.denied");
  assert.equal(denied.length, before + 1, "exactly one real denial audited");
  assert.deepEqual(JSON.parse(denied.at(-1).detail), {
    route: "/api/memories/:id",
    need: "memories:write",
    principal: "service",
  });
  assert.equal(dbText().includes(PROBE), false, "audit table");
  assert.equal(dbText().includes(t.token), false, "token never audited");
  const http = await httpText();
  assert.equal(http.includes(PROBE), false, "audit HTTP");
  assert.equal(http.includes(t.token), false, "token never in audit HTTP");
});

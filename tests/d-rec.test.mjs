// D_REC — non-destructive audit of recovery/ownership invariants.
// Verifies the CURRENT behavior: resources of a deactivated admin stay owned, invisible and
// unclaimable; nothing is auto-transferred; content never reaches the audit. No transfer/purge
// is implemented or exercised here. Disposable temp database.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-drec-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
const { createApp } = await import("../server/index.js");
const { auth, db } = await import("../server/db.js");
const { ownerOf } = await import("../server/ownership.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const PROBE = "TOKEN_SECRETO_SONDA";
let server, base;
const A = {}, B = {};

const req = (path, { method = "GET", body, s, bearer } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(s ? { cookie: s.cookie, "x-jarvis-csrf": s.csrf } : {}),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const json = async (r) => ({ status: r.status, body: await r.json() });
async function login(u, target) {
  const r = await req("/api/auth/login", { method: "POST", body: { username: u, password: PW } });
  assert.equal(r.status, 200);
  const j = await r.json();
  Object.assign(target, { cookie: r.headers.get("set-cookie").split(";")[0], csrf: j.csrf, id: j.admin.id });
  target.principal = auth.validateSession(target.cookie.split("=")[1]);
}

let aMemoryId, aToken;

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  await login("ana", A);
  assert.equal((await req("/api/auth/admins", { method: "POST", body: { username: "bia", password: PW, currentPassword: PW }, s: A })).status, 200);
  await login("bia", B);
  // A owns a memory (with a sentinel secret) and a service token, BEFORE deactivation.
  const m = (await json(await req("/api/memories", { method: "POST", body: { content: `${PROBE} segredo da ana`, tags: "p" }, s: A }))).body;
  aMemoryId = m.id;
  aToken = (await json(await req("/api/auth/tokens", { method: "POST", body: { name: "t", scopes: ["memories:read"] }, s: A }))).body.token;
});
after(() => server.close());

test("D_REC: deactivation keeps ownership (no auto-transfer) and revokes A's access", async () => {
  assert.equal(ownerOf("memory", aMemoryId), A.id);
  assert.equal((await req(`/api/auth/admins/${A.id}`, { method: "DELETE", s: B })).status, 200);
  // No automatic transfer: the resource still belongs to the (now inactive) A.
  assert.equal(ownerOf("memory", aMemoryId), A.id, "ownership must not change on deactivation");
  // A can no longer authenticate (session invalid, token revoked).
  assert.equal((await req("/api/memories", { s: A })).status, 401, "deactivated admin session is refused");
  assert.equal((await req("/api/memories", { bearer: aToken })).status, 401, "deactivated admin token is revoked");
});

test("D_REC: inactive admin's resources are invisible and unclaimable to the other admin", async () => {
  const list = (await json(await req("/api/memories", { s: B }))).body.map((x) => x.id);
  assert.equal(list.includes(aMemoryId), false, "list must not expose it");
  const search = (await json(await req(`/api/memories?q=${encodeURIComponent(PROBE)}`, { s: B }))).body.map((x) => x.id);
  assert.equal(search.includes(aMemoryId), false, "search must not expose it");
  assert.equal((await req(`/api/memories/${aMemoryId}`, { method: "PUT", body: { content: "x" }, s: B })).status, 404);
  assert.equal((await req(`/api/memories/${aMemoryId}`, { method: "DELETE", s: B })).status, 404);
  // Not offered in the legacy triage (it has an owner), and claiming it is refused.
  const inv = (await json(await req("/api/legacy", { s: B }))).body.resources.memory.map((x) => x.id);
  assert.equal(inv.includes(aMemoryId), false, "owned-by-inactive must not appear in triage");
  assert.equal((await req("/api/legacy/claim", { method: "POST", body: { type: "memory", ids: [aMemoryId], confirm: "ASSUMIR" }, s: B })).status, 409, "already_owned");
  assert.equal(ownerOf("memory", aMemoryId), A.id);
});

test("D_REC: the sentinel secret never reaches the audit table or the audit API", async () => {
  const rows = db.prepare("SELECT kind, detail FROM audit").all();
  assert.equal(rows.some((r) => String(r.detail).includes(PROBE)), false, "content must not be in audit");
  const audit = (await json(await req("/api/audit", { s: B }))).body;
  assert.equal(JSON.stringify(audit).includes(PROBE), false, "audit API must not leak content");
});

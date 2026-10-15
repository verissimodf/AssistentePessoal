// D_REC-1/D_REC-3 — controlled transfer of a deactivated admin's resources + reauthentication.
// Synthetic data, disposable temp DB. No real transfer/purge; nothing touches production.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-drec-tr-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
const { createApp } = await import("../server/index.js");
const { auth, db } = await import("../server/db.js");
const { ownerOf } = await import("../server/ownership.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const SECRET = "SEGREDO_TRANSFER_SONDA_99";
let server, base;
const A = {}, B = {};
let mA, mB, agA;

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
async function login(u, t) {
  const r = await req("/api/auth/login", { method: "POST", body: { username: u, password: PW } });
  assert.equal(r.status, 200);
  const j = await r.json();
  Object.assign(t, { cookie: r.headers.get("set-cookie").split(";")[0], csrf: j.csrf, id: j.admin.id, principal: null });
}
const transfer = (s, body) => req("/api/ownership/transfer", { method: "POST", body, s });
const reauth = (s, password) => req("/api/auth/reauth", { method: "POST", body: { password }, s });

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  await login("ana", A);
  assert.equal((await req("/api/auth/admins", { method: "POST", body: { username: "bia", password: PW, currentPassword: PW }, s: A })).status, 200);
  await login("bia", B);
  // A owns two memories + one agent (with a sentinel secret).
  mA = (await json(await req("/api/memories", { method: "POST", body: { content: `${SECRET} A1`, tags: "a" }, s: A }))).body.id;
  mB = (await json(await req("/api/memories", { method: "POST", body: { content: "outra memoria da ana", tags: "a" }, s: A }))).body.id;
  agA = (await json(await req("/api/agents", { method: "POST", body: { name: "agente da ana", provider: "ollama", tools: [] }, s: A }))).body.id;
  // B deactivates A (allowed: 2 admins, A is not the last).
  assert.equal((await req(`/api/auth/admins/${A.id}`, { method: "DELETE", s: B })).status, 200);
  // B reauthenticates (fresh, bound to B's session).
  assert.equal((await reauth(B, PW)).status, 200);
});
after(() => server.close());

test("D_REC-1: transfers only the selected resources; unselected stay with the source", async () => {
  const r = await json(await transfer(B, { from: A.id, to: B.id, type: "memory", ids: [mA], confirm: "TRANSFERIR" }));
  assert.equal(r.status, 200);
  assert.equal(r.body.count, 1);
  assert.equal(ownerOf("memory", mA), B.id, "selected memory moved to B");
  assert.equal(ownerOf("memory", mB), A.id, "unselected memory stays with A");
  assert.equal(ownerOf("agent", agA), A.id, "unselected agent stays with A");
  // Visibility follows ownership.
  const idsB = (await json(await req("/api/memories", { s: B }))).body.map((x) => x.id);
  assert.ok(idsB.includes(mA) && !idsB.includes(mB));
});

test("D_REC-3: transfer requires a fresh reauthentication", async () => {
  await login("bia", B); // fresh session → reauth_at cleared
  const noReauth = await json(await transfer(B, { from: A.id, to: B.id, type: "memory", ids: [mB], confirm: "TRANSFERIR" }));
  assert.equal(noReauth.status, 403);
  assert.equal(noReauth.body.error, "reauth_required");
  assert.equal(ownerOf("memory", mB), A.id, "nothing changed without reauth");
  // Wrong password does not grant reauth.
  assert.equal((await reauth(B, "senha-errada-12345")).status, 403);
  assert.equal((await transfer(B, { from: A.id, to: B.id, type: "memory", ids: [mB], confirm: "TRANSFERIR" })).status, 403);
});

test("D_REC-1: explicit confirmation is required", async () => {
  await reauth(B, PW);
  assert.equal((await transfer(B, { from: A.id, to: B.id, type: "memory", ids: [mB], confirm: "nope" })).status, 400);
  assert.equal(ownerOf("memory", mB), A.id);
});

test("D_REC-1: source must be inactive and target active", async () => {
  await reauth(B, PW);
  assert.equal((await transfer(B, { from: B.id, to: B.id, type: "memory", ids: [mB], confirm: "TRANSFERIR" })).status, 400, "same admin");
  assert.equal((await transfer(B, { from: B.id, to: A.id, type: "memory", ids: [mB], confirm: "TRANSFERIR" })).status, 409, "source active");
  assert.equal((await transfer(B, { from: A.id, to: "nao-existe", type: "memory", ids: [mB], confirm: "TRANSFERIR" })).status, 409, "target inactive/unknown");
});

test("D_REC-1: a foreign or unknown id aborts the whole batch (no partial change)", async () => {
  await reauth(B, PW);
  // mB belongs to A; a resource owned by B would be foreign to `from: A`.
  const bMem = (await json(await req("/api/memories", { method: "POST", body: { content: "da bia", tags: "b" }, s: B }))).body.id;
  const r = await json(await transfer(B, { from: A.id, to: B.id, type: "memory", ids: [mB, bMem], confirm: "TRANSFERIR" }));
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "not_owned_by_source");
  assert.equal(ownerOf("memory", mB), A.id, "no partial change");
  assert.equal(ownerOf("memory", bMem), B.id, "no partial change");
  const unknown = await transfer(B, { from: A.id, to: B.id, type: "memory", ids: ["nao-existe"], confirm: "TRANSFERIR" });
  assert.equal(unknown.status, 404);
});

test("D_REC-1: malformed batches are rejected", async () => {
  await reauth(B, PW);
  const t = (ids, type = "memory") => transfer(B, { from: A.id, to: B.id, type, ids, confirm: "TRANSFERIR" });
  assert.equal((await t([])).status, 400);
  assert.equal((await t([mB, mB])).status, 400, "duplicate ids");
  assert.equal((await t([mB], "nope")).status, 400, "invalid type");
  assert.equal(ownerOf("memory", mB), A.id);
});

test("D_REC-1: repeating a completed transfer is refused (no double transfer)", async () => {
  await reauth(B, PW);
  assert.equal((await transfer(B, { from: A.id, to: B.id, type: "memory", ids: [mB], confirm: "TRANSFERIR" })).status, 200);
  assert.equal(ownerOf("memory", mB), B.id);
  const again = await transfer(B, { from: A.id, to: B.id, type: "memory", ids: [mB], confirm: "TRANSFERIR" });
  assert.equal(again.status, 409, "no longer owned by the source");
  assert.equal(ownerOf("memory", mB), B.id, "ownership unchanged on repeat");
});

test("D_REC-1: service tokens cannot transfer (session-only)", async () => {
  const { token } = auth.createServiceToken(auth.validateSession(B.cookie.split("=")[1]), { name: "t", scopes: ["settings:write"] });
  const r = await req("/api/ownership/transfer", { method: "POST", body: { from: A.id, to: B.id, type: "agent", ids: [agA], confirm: "TRANSFERIR" }, bearer: token });
  assert.equal(r.status, 403);
  assert.equal(ownerOf("agent", agA), A.id);
});

test("D_REC-1: the trail records actor/from/to/correlation and never leaks content", async () => {
  await reauth(B, PW);
  const r = await json(await transfer(B, { from: A.id, to: B.id, type: "agent", ids: [agA], confirm: "TRANSFERIR" }));
  assert.equal(r.status, 200);
  const corr = r.body.correlation;
  assert.ok(corr && corr.length > 0);
  const h = db.prepare("SELECT * FROM ownership_history WHERE correlation_id = ?").get(corr);
  assert.equal(h.resource_id, agA);
  assert.equal(h.from_admin_id, A.id);
  assert.equal(h.to_admin_id, B.id);
  assert.equal(h.actor_admin_id, B.id);
  assert.equal(h.action, "transfer");
  // No content/secret in the response or in the audit table.
  assert.equal(JSON.stringify(r.body).includes(SECRET), false);
  const audit = db.prepare("SELECT kind, detail FROM audit WHERE kind='ownership.transferred'").all();
  assert.ok(audit.length >= 1);
  assert.equal(audit.some((a) => String(a.detail).includes(SECRET)), false, "no content in audit");
  assert.ok(audit.some((a) => String(a.detail).includes(corr)), "correlation present in audit");
});

test("D_REC-4: inactive-admin inventory is metadata only (no content)", async () => {
  const inv = (await json(await req("/api/ownership/inactive", { s: B }))).body;
  const ana = inv.find((x) => x.id === A.id);
  assert.ok(ana, "inactive admin listed");
  assert.equal(typeof ana.counts.memory, "number");
  assert.equal(JSON.stringify(inv).includes(SECRET), false, "no content");
  assert.equal(JSON.stringify(inv).includes("outra memoria da ana"), false, "no memory text");
});

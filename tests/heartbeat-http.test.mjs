import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-heartbeat-http-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { auth, db } = await import("../server/db.js");
const { createApp } = await import("../server/index.js");
const { createHeartbeat } = await import("../server/heartbeat.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const uuid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
let next = 0;
const heartbeat = createHeartbeat({ db, uid: () => uuid(++next), enabled: true });
let server, base, A, B, intentA;

const login = async (username) => {
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ username, password: PW }),
  });
  assert.equal(r.status, 200);
  const sid = r.headers.get("set-cookie").split(";")[0].split("=")[1];
  return { principal: auth.validateSession(sid), cookie: `jarvis_sid=${sid}` };
};
const get = (sess, path) => fetch(`${base}${path}`, { headers: { origin: ORIGIN, cookie: sess?.cookie || "" } });
const post = (sess, path, body, csrf = true) => fetch(`${base}${path}`, {
  method: "POST",
  headers: {
    origin: ORIGIN,
    "content-type": "application/json",
    cookie: sess?.cookie || "",
    ...(csrf && sess ? { "x-jarvis-csrf": sess.principal.csrf } : {}),
  },
  body: JSON.stringify(body),
});

before(async () => {
  server = createApp({ heartbeat });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  A = await login("ana");
  const created = await post(A, "/api/auth/admins", { username: "bia", password: PW, currentPassword: PW });
  assert.equal(created.status, 200);
  B = await login("bia");
  intentA = heartbeat.insertIntent({
    adminId: A.principal.adminId,
    kind: "approval_pending",
    payload: { count: 1 },
    correlationId: uuid(901),
  }).intent;
});

after(() => server.close());

test("Heartbeat: sem sessão retorna 401", async () => {
  assert.equal((await get(null, "/api/heartbeat/status")).status, 401);
  assert.equal((await get(null, "/api/heartbeat/alerts")).status, 401);
});

test("Heartbeat: listagem isolada por admin e status real", async () => {
  const a = await get(A, "/api/heartbeat/alerts");
  const b = await get(B, "/api/heartbeat/alerts");
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal((await a.json()).alerts.length, 1);
  assert.equal((await b.json()).alerts.length, 0);
  assert.equal((await get(A, "/api/heartbeat/status")).status, 200);
});

test("Heartbeat: CSRF obrigatório e resolução não executa ferramenta", async () => {
  const denied = await post(A, `/api/heartbeat/alerts/${intentA.id}`, { action: "approve" }, false);
  assert.equal(denied.status, 403);
  const approved = await post(A, `/api/heartbeat/alerts/${intentA.id}`, { action: "approve" });
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).status, "approved");
  const repeat = await post(A, `/api/heartbeat/alerts/${intentA.id}`, { action: "reject" });
  assert.equal(repeat.status, 404);
});

test("Heartbeat: admin B não consegue resolver a intenção de A", async () => {
  const foreign = heartbeat.insertIntent({
    adminId: A.principal.adminId,
    kind: "execution_unverified",
    payload: { code: "unknown" },
    correlationId: uuid(902),
  }).intent;
  const result = await post(B, `/api/heartbeat/alerts/${foreign.id}`, { action: "reject" });
  assert.equal(result.status, 404);
  assert.equal(heartbeat.listIntents(A.principal.adminId).some((x) => x.id === foreign.id), true);
});

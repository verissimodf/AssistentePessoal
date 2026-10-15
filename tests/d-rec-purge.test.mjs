// D_REC-2 — MANUAL-ONLY purge of a deactivated admin's resources (no retention deadlines).
// Synthetic data, disposable temp DB. No real purge; nothing touches production.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-drec-pg-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
const { createApp } = await import("../server/index.js");
const { auth, db } = await import("../server/db.js");
const { ownerOf, createPurgeJob, executePurge, resumePurge, isQuarantined } =
  await import("../server/ownership.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const SECRET = "SEGREDO_PURGE_SONDA_77";
let server, base;
const A = {},
  B = {};
let m1, m2, m3, m4, mB, agA, doc;

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
  Object.assign(t, {
    cookie: r.headers.get("set-cookie").split(";")[0],
    csrf: j.csrf,
    id: j.admin.id,
  });
}
const purge = (s, body) => req("/api/ownership/purge", { method: "POST", body, s });
const resumeHttp = (s, id) =>
  req(`/api/ownership/purge/${id}/resume`, { method: "POST", body: {}, s });
const reauth = (s) => req("/api/auth/reauth", { method: "POST", body: { password: PW }, s });
const memExists = (id) => !!db.prepare("SELECT 1 FROM memories WHERE id = ?").get(id);
const auditRows = (kind) => db.prepare("SELECT detail FROM audit WHERE kind = ?").all(kind);

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  await login("ana", A);
  assert.equal(
    (
      await req("/api/auth/admins", {
        method: "POST",
        body: { username: "bia", password: PW, currentPassword: PW },
        s: A,
      })
    ).status,
    200,
  );
  await login("bia", B);
  const mk = async (content) =>
    (await json(await req("/api/memories", { method: "POST", body: { content, tags: "a" }, s: A })))
      .body.id;
  m1 = await mk(`${SECRET} um`);
  m2 = await mk("memoria dois");
  m3 = await mk("memoria tres");
  m4 = await mk("memoria quatro");
  agA = (
    await json(
      await req("/api/agents", {
        method: "POST",
        body: { name: "agente da ana", provider: "ollama", tools: [] },
        s: A,
      }),
    )
  ).body.id;
  doc = (
    await json(
      await req("/api/documents", {
        method: "POST",
        body: { name: "nota.txt", mime: "text/plain", content: `conteudo ${SECRET}` },
        s: A,
      }),
    )
  ).body.id;
  mB = (
    await json(
      await req("/api/memories", {
        method: "POST",
        body: { content: "memoria da bia", tags: "b" },
        s: B,
      }),
    )
  ).body.id;
  // B deactivates A (2 admins; A is not the last). Only inactive admins' resources are eligible.
  assert.equal((await req(`/api/auth/admins/${A.id}`, { method: "DELETE", s: B })).status, 200);
  assert.equal((await reauth(B)).status, 200);
});
after(() => server.close());

test("D_REC-2: requires fresh reauth and explicit confirmation", async () => {
  await login("bia", B); // fresh session → reauth cleared
  const noReauth = await json(
    await purge(B, { from: A.id, type: "memory", ids: [m1], confirm: "EXPURGAR" }),
  );
  assert.equal(noReauth.status, 403);
  assert.equal(noReauth.body.error, "reauth_required");
  assert.equal(memExists(m1), true, "nothing removed without reauth");
  await reauth(B);
  const noConfirm = await json(await purge(B, { from: A.id, type: "memory", ids: [m1] }));
  assert.equal(noConfirm.status, 400);
  assert.equal(noConfirm.body.error, "confirmation_required");
  assert.equal(memExists(m1), true, "nothing removed without confirmation");
});

test("D_REC-2: refuses ineligible resources (active source, foreign, unowned, missing)", async () => {
  const activeSource = await json(
    await purge(B, { from: B.id, type: "memory", ids: [mB], confirm: "EXPURGAR" }),
  );
  assert.equal(activeSource.status, 409);
  assert.equal(activeSource.body.error, "source_active");
  const foreign = await json(
    await purge(B, { from: A.id, type: "memory", ids: [mB], confirm: "EXPURGAR" }),
  );
  assert.equal(foreign.status, 409);
  assert.equal(foreign.body.error, "not_owned_by_source");
  // Make m4 unowned (ambiguous ownership) → must be preserved, never purged.
  db.prepare("DELETE FROM ownership WHERE resource_type = 'memory' AND resource_id = ?").run(m4);
  const unowned = await json(
    await purge(B, { from: A.id, type: "memory", ids: [m4], confirm: "EXPURGAR" }),
  );
  assert.equal(unowned.status, 409);
  assert.equal(unowned.body.error, "not_owned_by_source");
  assert.equal(memExists(m4), true, "ambiguous ownership preserved");
  const missing = await json(
    await purge(B, { from: A.id, type: "memory", ids: ["nao-existe"], confirm: "EXPURGAR" }),
  );
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error, "resource_not_found");
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM purge_jobs").get().n,
    0,
    "no job created for refused requests",
  );
});

test("D_REC-2: manual purge removes an eligible resource, records quarantine and audit", async () => {
  const r = await json(
    await purge(B, { from: A.id, type: "memory", ids: [m1], confirm: "EXPURGAR" }),
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "done");
  assert.equal(r.body.removed, 1);
  assert.equal(memExists(m1), false, "row removed");
  assert.ok(!ownerOf("memory", m1), "ownership removed");
  assert.equal(isQuarantined("memory", m1), true, "quarantined");
  const done = auditRows("purge.completed");
  assert.equal(done.length, 1, "completion audited");
  assert.equal(done[0].detail.includes(SECRET), false, "no content in audit");
});

test("D_REC-2: service tokens cannot purge (session-only)", async () => {
  const tok = (
    await json(
      await req("/api/auth/tokens", {
        method: "POST",
        body: { name: "sonda", scopes: ["memories:read"] },
        s: B,
      }),
    )
  ).body.token;
  const r = await json(
    await req("/api/ownership/purge", {
      method: "POST",
      body: { from: A.id, type: "memory", ids: [m2], confirm: "EXPURGAR" },
      bearer: tok,
    }),
  );
  assert.equal(r.status, 403);
  assert.equal(memExists(m2), true);
});

test("D_REC-2: repeating a completed purge is refused and changes nothing", async () => {
  const again = await json(
    await purge(B, { from: A.id, type: "memory", ids: [m1], confirm: "EXPURGAR" }),
  );
  assert.equal(again.status, 404);
  assert.equal(again.body.error, "resource_not_found");
});

test("D_REC-2: partial failure stays resumable; quarantine blocks transfer until resume", async () => {
  // Create a job but stop after the first item (test hook) → job left partially done.
  const jobId = createPurgeJob(B.id, { from: A.id, type: "memory", ids: [m2, m3] });
  assert.throws(() => executePurge(jobId, B.id, { failAfterItem: 1 }), /simulated_failure/);
  const states = db
    .prepare("SELECT resource_id, state FROM purge_items WHERE job_id = ? ORDER BY resource_id")
    .all(jobId);
  assert.deepEqual(
    states.map((x) => x.state).sort(),
    ["isolated", "removed"],
    "one removed, one still isolated",
  );
  const isolatedId = states.find((x) => x.state === "isolated").resource_id;
  assert.equal(isQuarantined("memory", isolatedId), true, "pending item quarantined");
  // Transfer of a quarantined resource is blocked (a purge is in progress).
  const blocked = await json(
    await req("/api/ownership/transfer", {
      method: "POST",
      body: { from: A.id, to: B.id, type: "memory", ids: [isolatedId], confirm: "TRANSFERIR" },
      s: B,
    }),
  );
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, "quarantined");
  // Resume via HTTP completes the job; a second resume is an idempotent no-op.
  const done = await json(await resumeHttp(B, jobId));
  assert.equal(done.status, 200);
  assert.equal(done.body.status, "done");
  assert.equal(memExists(m2) || memExists(m3), false, "both target rows removed");
  const idle = resumePurge(jobId, B.id);
  assert.equal(idle.status, "done");
  assert.equal(idle.removed, 0, "idempotent: nothing left to remove");
});

test("D_REC-2: purging a document also removes its stored file", async () => {
  const path = db.prepare("SELECT path FROM documents WHERE id = ?").get(doc).path;
  assert.equal(existsSync(path), true, "file exists before purge");
  const r = await json(
    await purge(B, { from: A.id, type: "document", ids: [doc], confirm: "EXPURGAR" }),
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "done");
  assert.equal(
    db.prepare("SELECT 1 FROM documents WHERE id = ?").get(doc),
    undefined,
    "row removed",
  );
  assert.equal(existsSync(path), false, "file removed");
});

test("D_REC-2: an unstarted job can be cancelled (quarantine released, data preserved)", async () => {
  const jobId = createPurgeJob(B.id, { from: A.id, type: "agent", ids: [agA] });
  assert.equal(isQuarantined("agent", agA), true, "quarantined while job is pending");
  const blocked = await json(
    await req("/api/ownership/transfer", {
      method: "POST",
      body: { from: A.id, to: B.id, type: "agent", ids: [agA], confirm: "TRANSFERIR" },
      s: B,
    }),
  );
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, "quarantined");
  const cancelled = await json(
    await req(`/api/ownership/purge/${jobId}/cancel`, { method: "POST", body: {}, s: B }),
  );
  assert.equal(cancelled.status, 200);
  assert.equal(isQuarantined("agent", agA), false, "quarantine released");
  assert.ok(db.prepare("SELECT 1 FROM agents WHERE id = ?").get(agA), "resource preserved");
  assert.equal(
    db.prepare("SELECT 1 FROM purge_jobs WHERE id = ?").get(jobId),
    undefined,
    "job removed",
  );
  // A job that already removed rows cannot be cancelled (no half-purged state with a stale quarantine).
  const r = await json(
    await purge(B, { from: A.id, type: "agent", ids: [agA], confirm: "EXPURGAR" }),
  );
  assert.equal(r.body.status, "done");
  const late = await json(
    await req(`/api/ownership/purge/${r.body.job}/cancel`, { method: "POST", body: {}, s: B }),
  );
  assert.equal(late.status, 409);
  assert.equal(late.body.error, "not_cancellable");
});

test("D_REC-2: job listing exposes metadata only, never content", async () => {
  const jobs = await json(await req("/api/ownership/purge", { s: B }));
  assert.equal(jobs.status, 200);
  assert.ok(jobs.body.length >= 1);
  const blob = JSON.stringify(jobs.body);
  assert.equal(blob.includes(SECRET), false, "no content in job listing");
  for (const j of jobs.body) {
    assert.deepEqual(Object.keys(j).sort(), [
      "correlation",
      "createdAt",
      "fromAdmin",
      "id",
      "pending",
      "status",
      "type",
    ]);
  }
});

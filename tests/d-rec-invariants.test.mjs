// D_REC invariants — regression lock for recovery/ownership rules that must never regress.
// Non-destructive; disposable temp DB; no transfer/purge implemented or exercised.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-drec-inv-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
const { createApp } = await import("../server/index.js");
const { auth, db, agents } = await import("../server/db.js");
const { ownerOf } = await import("../server/ownership.js");
const { encrypt } = await import("../server/settings.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const SECRET = "CONTEUDO_PRIVADO_SONDA_42";
let server, base;
const A = {},
  B = {};

const req = (path, { method = "GET", body, s } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(s ? { cookie: s.cookie, "x-jarvis-csrf": s.csrf } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const json = async (r) => ({ status: r.status, body: await r.json() });
async function login(u, target) {
  const r = await req("/api/auth/login", { method: "POST", body: { username: u, password: PW } });
  assert.equal(r.status, 200);
  const j = await r.json();
  Object.assign(target, {
    cookie: r.headers.get("set-cookie").split(";")[0],
    csrf: j.csrf,
    id: j.admin.id,
  });
}

let aAgentId, aMemId;

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  await login("ana", A);
  // A owns an agent and a memory BEFORE a second admin exists.
  aAgentId = (
    await json(
      await req("/api/agents", {
        method: "POST",
        body: { name: "da ana", provider: "ollama", tools: [] },
        s: A,
      }),
    )
  ).body.id;
  aMemId = (
    await json(
      await req("/api/memories", {
        method: "POST",
        body: { content: `${SECRET} da ana`, tags: "p" },
        s: A,
      }),
    )
  ).body.id;
  // Create a second admin — this must NOT transfer A's resources.
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
  // Synthetic legacy (unowned) rows + a legacy settings block, as a pre-Phase-2 install would have.
  db.prepare(
    "INSERT INTO memories (id, content, tags, created_at) VALUES ('lmX', ?, 'legado', '2025-01-01')",
  ).run(SECRET);
  db.prepare("INSERT INTO legacy_settings (id, data) VALUES (1, ?)").run(
    JSON.stringify({ providers: { openai: { apiKey: encrypt("sk-legado-secreto") } } }),
  );
});
after(() => server.close());

test("D_REC: creating a new admin does not transfer existing resources", async () => {
  assert.equal(ownerOf("agent", aAgentId), A.id, "agent stays with A");
  assert.equal(ownerOf("memory", aMemId), A.id, "memory stays with A");
  assert.equal(
    (await json(await req("/api/agents", { s: B }))).body.some((x) => x.id === aAgentId),
    false,
    "B sees none of A's agents",
  );
  assert.equal(
    (await json(await req("/api/memories", { s: B }))).body.some((x) => x.id === aMemId),
    false,
    "B sees none of A's memories",
  );
  assert.equal(
    (await req(`/api/agents/${aAgentId}`, { method: "DELETE", s: B })).status,
    404,
    "B cannot delete A's agent",
  );
});

test("D_REC: triage exposes metadata only — never content or secret values", async () => {
  const inv = (await json(await req("/api/legacy", { s: B }))).body;
  // Resource entries carry only id + date.
  const item = inv.resources.memory.find((x) => x.id === "lmX");
  assert.ok(item, "legacy row is listed");
  assert.deepEqual(Object.keys(item).sort(), ["date", "id"], "only metadata fields");
  // No private content anywhere in the inventory payload.
  assert.equal(JSON.stringify(inv).includes(SECRET), false, "no resource content");
  // Legacy settings expose key names/classification only, never values.
  assert.equal(inv.settings.present, true);
  assert.equal(
    JSON.stringify(inv.settings).includes("sk-legado-secreto"),
    false,
    "no secret value",
  );
  for (const k of inv.settings.keys || [])
    assert.deepEqual(Object.keys(k).sort(), ["class", "key", "secret"], "key metadata only");
});

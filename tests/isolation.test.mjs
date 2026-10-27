// Phase 2 — isolation between two admins, unowned (legacy) data blocked, explicit audited claims.
// Boots the real HTTP service on an ephemeral port with a temporary data dir and synthetic data.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-iso-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
const { createApp } = await import("../server/index.js");
const { auth, db, agents, bots } = await import("../server/db.js");
const { callTool } = await import("../server/tools.js");
const { runBot, triggerByText } = await import("../server/bots.js");
const { getSettings, encrypt } = await import("../server/settings.js");
const { ownerOf } = await import("../server/ownership.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
let server, base;
const A = {},
  B = {};

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
  Object.assign(target, {
    cookie: r.headers.get("set-cookie").split(";")[0],
    csrf: j.csrf,
    id: j.admin.id,
  });
  target.principal = auth.validateSession(target.cookie.split("=")[1]);
}

// Synthetic legacy rows (no owner), inserted the way a pre-Phase-2 install would have them.
const LEGACY_SECRET = "conteudo-legado-secreto-xyz";
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
  db.prepare(
    "INSERT INTO memories (id, content, tags, created_at) VALUES ('lm1', ?, 'legado', '2025-01-01')",
  ).run(LEGACY_SECRET);
  db.prepare(
    "INSERT INTO memories (id, content, tags, created_at) VALUES ('lm2', 'outro legado', '', '2025-01-02')",
  ).run();
  agents.save({
    id: "lagent",
    name: "Agente legado",
    instructions: LEGACY_SECRET,
    provider: "ollama",
    tools: [],
  });
  bots.save({
    id: "lbot",
    name: "Bot legado",
    goal: LEGACY_SECRET,
    enabled: true,
    trigger_type: "message",
    trigger_value: "gatilho",
    owner_admin_id: A.id,
  });
  db.prepare(
    "INSERT INTO approvals (id, command, status, created_at) VALUES ('lap', 'echo legado', 'pending', '2025-01-01')",
  ).run();
  db.prepare("INSERT INTO legacy_settings (id, data) VALUES (1, ?)").run(
    JSON.stringify({
      general: { language: "es", agentName: "Viejo", foo: 1 },
      providers: { openai: { enabled: true, apiKey: encrypt("sk-legado-123") } },
      weird: { x: 1 },
    }),
  );
});
after(() => server.close());

// ---------- memories ----------
test("memories: each admin reads/writes only their own; foreign ids look nonexistent", async () => {
  const m = await json(
    await req("/api/memories", {
      method: "POST",
      body: { content: "segredo da ana", tags: "a" },
      s: A,
    }),
  );
  assert.equal(m.status, 200);
  assert.equal(ownerOf("memory", m.body.id), A.id);
  const listA = (await json(await req("/api/memories", { s: A }))).body.map((x) => x.id);
  const listB = (await json(await req("/api/memories", { s: B }))).body.map((x) => x.id);
  assert.ok(listA.includes(m.body.id));
  assert.equal(listB.includes(m.body.id), false);
  const exportedA = await json(await req("/api/memories/export", { s: A }));
  const exportedB = await json(await req("/api/memories/export", { s: B }));
  assert.equal(exportedA.status, 200);
  assert.ok(exportedA.body.memories.some((x) => x.id === m.body.id));
  assert.equal(
    exportedB.body.memories.some((x) => x.id === m.body.id),
    false,
  );
  assert.equal(exportedA.body.count, exportedA.body.memories.length);
  assert.equal(
    JSON.stringify(
      db.prepare("SELECT detail FROM audit WHERE kind='memory.exported'").all(),
    ).includes("segredo da ana"),
    false,
  );
  assert.equal(
    (
      await req(`/api/memories/${m.body.id}`, {
        method: "PUT",
        body: { content: "memória corrigida da ana", tags: "a,corrigida" },
        s: A,
      })
    ).status,
    200,
  );
  assert.deepEqual(
    { ...db.prepare("SELECT content, tags FROM memories WHERE id=?").get(m.body.id) },
    { content: "memória corrigida da ana", tags: "a,corrigida" },
  );
  assert.equal((await json(await req("/api/memories?q=segredo", { s: B }))).body.length, 0);
  assert.equal(
    (await req(`/api/memories/${m.body.id}`, { method: "PUT", body: { content: "hack" }, s: B }))
      .status,
    404,
  );
  assert.equal((await req(`/api/memories/${m.body.id}`, { method: "DELETE", s: B })).status, 404);
  assert.equal(
    db.prepare("SELECT content FROM memories WHERE id=?").get(m.body.id).content,
    "memória corrigida da ana",
  );
});

test("memories: unowned legacy rows are invisible to both admins (list, search, edit, delete)", async () => {
  for (const s of [A, B]) {
    const list = (await json(await req("/api/memories", { s }))).body.map((x) => x.id);
    assert.equal(list.includes("lm1"), false);
    // With embeddings active a search may legitimately return the admin's OWN memories
    // (semantic match), so the invariant is ownership — never a foreign or legacy row —
    // not an empty result set.
    const found = (await json(await req(`/api/memories?q=${LEGACY_SECRET}`, { s }))).body;
    assert.equal(
      found.some((m) => m.id === "lm1" || m.id === "lm2"),
      false,
      "legacy rows must not leak",
    );
    for (const m of found)
      assert.equal(ownerOf("memory", m.id), s.id, "every returned row belongs to the caller");
    assert.equal(
      (await req("/api/memories/lm1", { method: "PUT", body: { content: "x" }, s })).status,
      404,
    );
    assert.equal((await req("/api/memories/lm1", { method: "DELETE", s })).status, 404);
  }
  assert.equal(
    db.prepare("SELECT content FROM memories WHERE id='lm1'").get().content,
    LEGACY_SECRET,
  );
});

// ---------- agents & bots ----------
test("agents and bots: isolated per owner; PUT on a foreign or unknown id cannot create/claim it", async () => {
  const ag = (
    await json(
      await req("/api/agents", {
        method: "POST",
        body: { name: "Meu", provider: "ollama", tools: [] },
        s: A,
      }),
    )
  ).body;
  const bt = (
    await json(
      await req("/api/bots", {
        method: "POST",
        body: { name: "B1", goal: "g", enabled: false },
        s: A,
      }),
    )
  ).body;
  assert.equal(bt.owner_admin_id, A.id);
  for (const [path, id] of [
    ["agents", ag.id],
    ["bots", bt.id],
  ]) {
    assert.equal(
      (await json(await req(`/api/${path}`, { s: B }))).body.some((x) => x.id === id),
      false,
    );
    assert.equal(
      (await req(`/api/${path}/${id}`, { method: "PUT", body: { name: "x" }, s: B })).status,
      404,
    );
    assert.equal((await req(`/api/${path}/${id}`, { method: "DELETE", s: B })).status, 404);
  }
  assert.equal(
    (await req("/api/agents/lagent", { method: "PUT", body: { name: "meu agora" }, s: A })).status,
    404,
  );
  assert.equal(
    (await req("/api/bots/novo-id", { method: "PUT", body: { name: "x" }, s: A })).status,
    404,
  );
  assert.equal(agents.get("novo-id"), null);
  assert.equal(
    (await req(`/api/bots/${bt.id}/run`, { method: "POST", body: {}, s: B })).status,
    404,
  );
  assert.equal((await req(`/api/bots/${bt.id}/runs`, { s: B })).status, 404);
  assert.equal((await req("/api/agents", { s: A })).status, 200);
  assert.equal(
    (await json(await req("/api/agents", { s: A }))).body.some((x) => x.id === "lagent"),
    false,
  );
});

test("chat cannot use another admin's agent or a legacy agent", async () => {
  const ag = (
    await json(
      await req("/api/agents", {
        method: "POST",
        body: { name: "Privado", provider: "ollama", tools: [] },
        s: A,
      }),
    )
  ).body;
  for (const agentId of [ag.id, "lagent"]) {
    const r = await json(
      await req("/api/chat", {
        method: "POST",
        body: { agentId, messages: [{ role: "user", content: "oi" }] },
        s: B,
      }),
    );
    assert.equal(r.status, 200);
    assert.match(r.body.reply, /sem permissão/);
  }
});

test("legacy bot (JSON owner field only, no ownership record) is blocked everywhere and audited", async () => {
  assert.equal(ownerOf("bot", "lbot"), null, "no automatic assignment from the JSON field");
  const r = await runBot(bots.get("lbot"), "manual");
  assert.equal(r.status, "denied");
  assert.ok(
    db
      .prepare(
        "SELECT 1 FROM audit WHERE kind='authz.bot_denied' AND detail LIKE '%legacy_blocked%'",
      )
      .get(),
  );
  assert.equal(triggerByText("message", "gatilho", A.id).length, 0);
  assert.equal(triggerByText("message", "gatilho", null).length, 0);
  assert.equal((await req("/api/bots/lbot/run", { method: "POST", body: {}, s: A })).status, 404);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM runs WHERE bot_id='lbot'").get().n, 0);
});

// ---------- agent tools (execution path, not only routes) ----------
test("tools: remember/recall are scoped to the principal's admin; no owner → denied", async () => {
  const cA = { autonomy: "confirm", pending: [], principal: A.principal };
  const cB = { autonomy: "confirm", pending: [], principal: B.principal };
  assert.match(
    await callTool("remember", { content: "ana gosta de chá verde", tags: "pref" }, cA),
    /salva/,
  );
  assert.match(await callTool("recall", { query: "chá verde" }, cA), /chá verde/);
  assert.match(await callTool("recall", { query: "chá verde" }, cB), /Nada encontrado/);
  // A query about the legacy secret must never surface the legacy CONTENT; A may still get
  // their own semantically-similar memory, which is legitimate — the invariant is content/ownership.
  assert.doesNotMatch(
    await callTool("recall", { query: LEGACY_SECRET }, cA),
    new RegExp(LEGACY_SECRET),
    "legacy content must not leak",
  );
  const orphan = {
    autonomy: "confirm",
    pending: [],
    principal: { type: "channel", channel: "telegram", adminId: null, scopes: ["memories:read"] },
  };
  assert.match(await callTool("recall", { query: "chá" }, orphan), /Permissão negada/);
  assert.match(
    await callTool("send_message", { channel: "telegram", text: "x" }, { ...cA }),
    /não habilitado|Permissão negada/,
  );
});

test("isolation holds with semantic search: a query close to A's memory never returns it to B", async () => {
  const secret = "coordenada secreta da ana: alfa-bravo-charlie";
  await req("/api/memories", { method: "POST", body: { content: secret, tags: "privado" }, s: A });
  const q = "coordenada secreta alfa bravo charlie";
  const cA = { autonomy: "confirm", pending: [], principal: A.principal };
  const cB = { autonomy: "confirm", pending: [], principal: B.principal };
  // A legitimately finds their own memory (keyword and/or semantic match).
  assert.match(await callTool("recall", { query: q }, cA), /alfa-bravo-charlie/);
  // B must never see it, even with a query crafted to match A's memory semantically.
  const forB = await callTool("recall", { query: q }, cB);
  assert.doesNotMatch(forB, /alfa-bravo-charlie/, "cross-admin leak via semantic search (tool)");
  assert.doesNotMatch(forB, /coordenada secreta/, "cross-admin leak via semantic search (tool)");
  // And through the HTTP search route as well.
  const bSearch = (await json(await req("/api/memories?q=coordenada%20secreta%20alfa", { s: B })))
    .body;
  assert.equal(
    bSearch.some((m) => String(m.content || "").includes("alfa-bravo-charlie")),
    false,
    "cross-admin leak via semantic search (HTTP)",
  );
  const aSearch = (await json(await req("/api/memories?q=coordenada%20secreta%20alfa", { s: A })))
    .body;
  assert.ok(
    aSearch.some((m) => String(m.content || "").includes("alfa-bravo-charlie")),
    "owner still finds their own memory",
  );
});

test("approvals: owned by the requester; the other admin and legacy approvals cannot be resolved", async () => {
  await req("/api/settings", {
    method: "PUT",
    body: { host: { enabled: true, allowlist: "echo" } },
    s: A,
  });
  const cA = { autonomy: "confirm", pending: [], principal: A.principal };
  await callTool("run_command", { command: "echo oi" }, cA);
  assert.equal(cA.pending.length, 1);
  const id = cA.pending[0].id;
  assert.equal(ownerOf("approval", id), A.id);
  assert.equal(
    (await req(`/api/approvals/${id}`, { method: "POST", body: { approve: true }, s: B })).status,
    404,
  );
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "pending");
  assert.equal(
    (await req("/api/approvals/lap", { method: "POST", body: { approve: true }, s: A })).status,
    404,
  );
  assert.equal(
    (await req("/api/approvals/nao-existe", { method: "POST", body: { approve: true }, s: A }))
      .status,
    404,
  );
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id='lap'").get().status, "pending");
  assert.match(
    (
      await json(
        await req(`/api/approvals/${id}`, { method: "POST", body: { approve: false }, s: A }),
      )
    ).body.output,
    /Negado/,
  );
  await req("/api/settings", { method: "PUT", body: { host: { enabled: false } }, s: A });
});

// ---------- settings ----------
test("settings: personal values and credentials are separated; global policy is shared", async () => {
  await req("/api/settings", {
    method: "PUT",
    body: {
      general: { language: "en" },
      providers: { openai: { enabled: true, apiKey: "sk-da-ana" } },
    },
    s: A,
  });
  const pa = (await json(await req("/api/settings", { s: A }))).body;
  const pb = (await json(await req("/api/settings", { s: B }))).body;
  assert.equal(pa.general.language, "en");
  assert.equal(pb.general.language, "pt");
  assert.equal(pa.providers.openai.hasKey, true);
  assert.equal(pa.providers.openai.apiKey, "");
  assert.equal(pb.providers.openai, undefined);
  assert.equal(getSettings(A.id).providers.openai.apiKey, "sk-da-ana");
  assert.equal(getSettings(B.id).providers.openai, undefined);
  assert.equal(getSettings(null).providers.openai, undefined);
  const raw = db.prepare("SELECT data FROM admin_settings WHERE admin_id=?").get(A.id).data;
  assert.equal(raw.includes("sk-da-ana"), false, "secret stored encrypted");
  await req("/api/settings", {
    method: "PUT",
    body: { host: { enabled: false, allowlist: "ls" } },
    s: B,
  });
  assert.equal(getSettings(A.id).host.allowlist, "ls", "host policy is global");
});

test("settings: a service token can change personal values but never the global policy", async () => {
  const { token } = (
    await json(
      await req("/api/auth/tokens", {
        method: "POST",
        body: { name: "t", scopes: ["settings:read", "settings:write"] },
        s: B,
      }),
    )
  ).body;
  const r = await json(
    await req("/api/settings", {
      method: "PUT",
      body: { host: { enabled: true, allowlist: "rm" } },
      bearer: token,
    }),
  );
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "global_settings_admin_only");
  assert.equal(getSettings(B.id).host.enabled, false);
  assert.equal(getSettings(B.id).host.allowlist, "ls");
  assert.equal(
    (
      await req("/api/settings", {
        method: "PUT",
        body: { general: { language: "es" } },
        bearer: token,
      })
    ).status,
    200,
  );
  assert.equal(getSettings(B.id).general.language, "es");
  assert.equal(getSettings(A.id).general.language, "en");
});

// ---------- legacy inventory + claims ----------
test("legacy inventory exposes metadata only (ids, dates, key names) — never content or secrets", async () => {
  const r = await req("/api/legacy", { s: A });
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.equal(text.includes(LEGACY_SECRET), false);
  assert.equal(text.includes("sk-legado"), false);
  assert.equal(text.includes("enc:"), false);
  const j = JSON.parse(text);
  assert.deepEqual(
    j.resources.memory.map((m) => m.id),
    ["lm1", "lm2"],
  );
  assert.deepEqual(
    j.resources.bot.map((m) => m.id),
    ["lbot"],
  );
  assert.ok(j.resources.approval.some((x) => x.id === "lap"));
  const key = j.settings.keys.find((k) => k.key === "providers.openai.apiKey");
  assert.deepEqual(key, { key: "providers.openai.apiKey", class: "personal", secret: true });
  assert.equal(j.settings.keys.find((k) => k.key === "weird.x").class, "unclassified");
  const { token } = (
    await json(
      await req("/api/auth/tokens", {
        method: "POST",
        body: { name: "r", scopes: ["memories:read"] },
        s: A,
      }),
    )
  ).body;
  assert.equal((await req("/api/legacy", { bearer: token })).status, 403);
});

test("claim: validated, all-or-nothing, never over an owned resource, audited with the admin", async () => {
  const claim = async (body, s = A) =>
    json(await req("/api/legacy/claim", { method: "POST", body, s }));
  assert.equal((await claim({ type: "memory", ids: ["lm1"] })).body.error, "confirmation_required");
  assert.equal(
    (await claim({ type: "admins", ids: ["lm1"], confirm: "ASSUMIR" })).body.error,
    "invalid_type",
  );
  assert.equal(
    (await claim({ type: "memory", ids: [], confirm: "ASSUMIR" })).body.error,
    "invalid_ids",
  );
  assert.equal(
    (await claim({ type: "memory", ids: ["lm1", "lm1"], confirm: "ASSUMIR" })).body.error,
    "duplicate_ids",
  );
  const partial = await claim({ type: "memory", ids: ["lm1", "nao-existe"], confirm: "ASSUMIR" });
  assert.equal(partial.status, 404);
  assert.equal(ownerOf("memory", "lm1"), null, "no partial assignment");
  const mine = (await json(await req("/api/memories", { s: A }))).body[0].id;
  const stolen = await claim({ type: "memory", ids: ["lm2", mine], confirm: "ASSUMIR" }, B);
  assert.equal(stolen.status, 409);
  assert.equal(ownerOf("memory", "lm2"), null);
  const ok = await claim({ type: "memory", ids: ["lm1"], confirm: "ASSUMIR" });
  assert.equal(ok.status, 200);
  assert.equal(ownerOf("memory", "lm1"), A.id);
  assert.equal((await claim({ type: "memory", ids: ["lm1"], confirm: "ASSUMIR" }, B)).status, 409);
  assert.ok((await json(await req("/api/memories", { s: A }))).body.some((m) => m.id === "lm1"));
  assert.equal(
    (await json(await req("/api/memories", { s: B }))).body.some((m) => m.id === "lm1"),
    false,
  );
  const row = db
    .prepare(
      "SELECT admin_id FROM legacy_claims WHERE resource_type='memory' AND resource_id='lm1'",
    )
    .get();
  assert.equal(row.admin_id, A.id);
  const a = db
    .prepare("SELECT detail FROM audit WHERE kind='legacy.claimed' ORDER BY id DESC")
    .get().detail;
  assert.match(a, new RegExp(A.id));
  assert.equal(a.includes(LEGACY_SECRET), false);
  // claimed legacy bot runs again under its new owner's isolation
  assert.equal((await claim({ type: "bot", ids: ["lbot"], confirm: "ASSUMIR" }, B)).status, 200);
  assert.equal(triggerByText("message", "gatilho", A.id).length, 0);
});

test("legacy settings: whole-block claim, confirmation, refused over existing personal settings, no secret leak", async () => {
  const c = async (s, confirm = "ASSUMIR CONFIGURACOES") =>
    json(await req("/api/legacy/settings/claim", { method: "POST", body: { confirm }, s }));
  assert.equal((await c(A, "sim")).body.error, "confirmation_required");
  assert.equal((await c(A)).body.error, "personal_settings_not_empty");
  db.prepare("DELETE FROM admin_settings WHERE admin_id=?").run(B.id); // B starts clean for this check
  const r = await req("/api/legacy/settings/claim", {
    method: "POST",
    body: { confirm: "ASSUMIR CONFIGURACOES" },
    s: B,
  });
  const text = await r.text();
  assert.equal(r.status, 200);
  assert.equal(text.includes("sk-legado"), false);
  assert.equal(getSettings(B.id).providers.openai.apiKey, "sk-legado-123");
  assert.equal(getSettings(B.id).general.language, "es");
  assert.equal(getSettings(B.id).general.foo, undefined, "unclassified key stays inactive");
  assert.equal(getSettings(A.id).providers.openai.apiKey, "sk-da-ana");
  assert.equal((await c(A)).body.error, "already_claimed");
  assert.ok(
    JSON.parse(db.prepare("SELECT data FROM legacy_settings").get().data).weird,
    "legacy block preserved",
  );
  const audits = db
    .prepare("SELECT detail FROM audit")
    .all()
    .map((x) => x.detail)
    .join("\n");
  assert.equal(audits.includes("sk-legado"), false);
  assert.equal(audits.includes("sk-da-ana"), false);
});

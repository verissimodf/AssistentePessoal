// Fase 4 — agent/bot drafts for human approval (D9) and account ownership.
// Synthetic data + MOCK transport only: no network, no credentials, no real mailbox, no real send.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-mail-drafts-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
const { createApp } = await import("../server/index.js");
const { auth, db } = await import("../server/db.js");
const { setMailTransport } = await import("../server/mail-service.js");
const { createDraftStore, setDraftStore } = await import("../server/mail-drafts.js");
const { callTool } = await import("../server/tools.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const SECRET = "SENHA_APP_DRAFT_SONDA_33";
const BODY = "CORPO_RASCUNHO_PRIVADO_77";
let server, base;
const A = {},
  B = {};

const tstate = { sent: [], mode: "ok" };
const transport = {
  async list() {
    return { messages: [], total: 0 };
  },
  async read(_a, id) {
    return { id };
  },
  async search() {
    return { messages: [], total: 0 };
  },
  async send(_a, outgoing) {
    if (tstate.mode === "fail") throw Object.assign(new Error("boom"), { code: "ECONNRESET" });
    tstate.sent.push(outgoing);
    return { messageId: "d1" };
  },
};

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
/** Same session cookie, but WITHOUT the CSRF header (to prove mutating routes reject it). */
const reqNoCsrf = (path, { method = "POST", body, s } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      cookie: s.cookie,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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
const auditText = () => JSON.stringify(db.prepare("SELECT kind, detail FROM audit").all());
const agentCtx = (adminId) => ({
  autonomy: "confirm",
  pending: [],
  principal: { type: "service", adminId, scopes: ["comms:read", "comms:send"] },
});
const draftId = (toolOutput) => (toolOutput.match(/id ([0-9a-f-]{36})/) || [])[1];

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  setMailTransport(transport, { timeoutMs: 50, sleep: async () => {} });
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
  assert.equal(
    (
      await req("/api/settings", {
        method: "PUT",
        body: {
          comms: { gmail: { enabled: true, user: "ana@exemplo.test", appPassword: SECRET } },
        },
        s: A,
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await req("/api/settings", {
        method: "PUT",
        body: {
          comms: { outlook: { enabled: true, user: "bia@exemplo.test", appPassword: SECRET } },
        },
        s: B,
      })
    ).status,
    200,
  );
});
after(() => server.close());

// ---------- draft store (unit) ----------

test("drafts: store is owner-bound, single-use, stateful and expiring", () => {
  let t = 1_000;
  const store = createDraftStore({ ttlMs: 100, outcomeTtlMs: 50, max: 2, now: () => t });
  const { id } = store.put({
    adminId: "A",
    account: "gmail",
    to: "x@y.z",
    subject: "s",
    body: "b",
  });
  assert.equal(store.get(id, "A").state, "pending");
  assert.equal(store.get(id, "A").body, "b");
  assert.equal(store.get(id, "B"), null, "another admin cannot read it");
  assert.equal(store.get("unknown", "A"), null);
  assert.equal(store.claim(id, "B"), null, "another admin cannot claim it");
  assert.equal(store.claim(id, "A").body, "b", "owner claims the body once");
  assert.equal(store.get(id, "A").body, null, "body dropped as soon as it is claimed");
  assert.equal(store.claim(id, "A"), null, "single-use: no replay");
  assert.equal(store.settle(id, "A", "sent"), true);
  assert.equal(store.get(id, "A").state, "sent");
  const live = store.put({
    adminId: "A",
    account: "gmail",
    to: "x@y.z",
    subject: "s",
    body: "segredo",
  }).id;
  t = 1_100;
  assert.equal(store.get(live, "A").state, "expired", "past its TTL a pending draft expires");
  assert.equal(store.get(live, "A").body, null, "expired drafts keep no body");
  t = 1_200;
  assert.equal(
    store.get(live, "A"),
    null,
    "terminal records are discarded after the outcome window",
  );
});

test("drafts: cancel discards a pending draft and cannot be replayed", () => {
  const store = createDraftStore();
  const { id } = store.put({
    adminId: "A",
    account: "gmail",
    to: "x@y.z",
    subject: "s",
    body: "b",
  });
  assert.equal(store.cancel(id, "B"), false, "another admin cannot cancel");
  assert.equal(store.cancel(id, "A"), true);
  assert.equal(store.get(id, "A").state, "cancelled");
  assert.equal(store.get(id, "A").body, null, "cancelled drafts keep no body");
  assert.equal(store.claim(id, "A"), null, "a cancelled draft can never be sent");
  assert.equal(store.cancel(id, "A"), false, "already cancelled");
});

test("drafts: list returns only the admin's own metadata, never the body", () => {
  const store = createDraftStore();
  store.put({ adminId: "A", account: "gmail", to: "a@x.test", subject: "sa", body: "segredoA" });
  store.put({ adminId: "B", account: "outlook", to: "b@x.test", subject: "sb", body: "segredoB" });
  const list = store.list("A");
  assert.equal(list.length, 1, "only the caller's drafts");
  assert.equal(list[0].to, "a@x.test");
  assert.deepEqual(Object.keys(list[0]).sort(), [
    "account",
    "createdAt",
    "expiresAt",
    "id",
    "state",
    "subject",
    "to",
  ]);
  assert.equal(JSON.stringify(list).includes("segredo"), false, "list never carries the body");
});

test("drafts: the store evicts the oldest entry past its capacity", () => {
  const store = createDraftStore({ max: 2 });
  const a = store.put({ adminId: "A", account: "gmail", to: "x@y.z", subject: "a", body: "1" }).id;
  store.put({ adminId: "A", account: "gmail", to: "x@y.z", subject: "b", body: "2" });
  store.put({ adminId: "A", account: "gmail", to: "x@y.z", subject: "c", body: "3" });
  assert.equal(store.size(), 2);
  assert.equal(store.get(a, "A"), null, "oldest evicted");
});

// ---------- tool creates a draft; never sends ----------

test("drafts: an agent tool prepares a draft and never sends", async () => {
  const before = tstate.sent.length;
  const out = await callTool(
    "send_email",
    { account: "gmail", to: "dest@exemplo.test", subject: "Assunto", body: BODY },
    agentCtx(A.id),
  );
  assert.match(out, /Nada foi enviado/i);
  assert.equal(tstate.sent.length, before, "transport send never called by the tool");
  const created = db
    .prepare("SELECT detail FROM audit WHERE kind = 'send_email(draft_created)'")
    .all();
  assert.ok(created.length >= 1);
  assert.equal(JSON.stringify(created).includes(BODY), false, "audit never carries the body");
  assert.equal(
    auditText().includes("dest@exemplo.test"),
    false,
    "audit never carries the recipient",
  );
  assert.ok(draftId(out), "a draft id is returned for the panel");
});

test("drafts: invalid input never creates a draft", async () => {
  const out = await callTool(
    "send_email",
    { account: "gmail", to: "nao-email", subject: "s", body: "b" },
    agentCtx(A.id),
  );
  assert.match(out, /Nao foi possivel preparar o envio/);
});

// ---------- review + explicit human confirmation ----------

test("drafts: review is session-only, then a confirmed send consumes the draft", async () => {
  const out = await callTool(
    "send_email",
    { account: "gmail", to: "dest@exemplo.test", subject: "Assunto", body: BODY },
    agentCtx(A.id),
  );
  const id = draftId(out);

  // A service token cannot review or send a draft (human-only).
  const tok = (
    await json(
      await req("/api/auth/tokens", {
        method: "POST",
        body: { name: "t", scopes: ["comms:read", "comms:send"] },
        s: A,
      }),
    )
  ).body.token;
  assert.equal((await req(`/api/mail/drafts/${id}`, { bearer: tok })).status, 403);
  assert.equal(
    (
      await req(`/api/mail/drafts/${id}/send`, {
        method: "POST",
        body: { confirm: "ENVIAR" },
        bearer: tok,
      })
    ).status,
    403,
  );

  // Review shows the draft for explicit human inspection.
  const view = await json(await req(`/api/mail/drafts/${id}`, { s: A }));
  assert.equal(view.status, 200);
  assert.equal(view.body.body, BODY);
  assert.equal(view.body.to, "dest@exemplo.test");
  assert.equal(
    (await json(await req(`/api/mail/drafts/${id}`, { s: A }))).status,
    200,
    "review does not consume",
  );

  // Sending requires the explicit confirmation.
  assert.equal(
    (await json(await req(`/api/mail/drafts/${id}/send`, { method: "POST", body: {}, s: A }))).body
      .error,
    "confirmation_required",
  );

  const sent = await json(
    await req(`/api/mail/drafts/${id}/send`, { method: "POST", body: { confirm: "ENVIAR" }, s: A }),
  );
  assert.equal(sent.status, 200);
  assert.equal(sent.body.ok, true);
  assert.deepEqual(tstate.sent.at(-1), { to: "dest@exemplo.test", subject: "Assunto", text: BODY });
  // Single-use: a second confirmation cannot resend.
  assert.equal(
    (
      await req(`/api/mail/drafts/${id}/send`, {
        method: "POST",
        body: { confirm: "ENVIAR" },
        s: A,
      })
    ).status,
    404,
  );
});

test("drafts: another admin cannot review or send a draft (indistinguishable from unknown)", async () => {
  const out = await callTool(
    "send_email",
    { account: "gmail", to: "dest@exemplo.test", subject: "s", body: BODY },
    agentCtx(A.id),
  );
  const id = draftId(out);
  assert.equal((await req(`/api/mail/drafts/${id}`, { s: B })).status, 404);
  assert.equal(
    (
      await req(`/api/mail/drafts/${id}/send`, {
        method: "POST",
        body: { confirm: "ENVIAR" },
        s: B,
      })
    ).status,
    404,
  );
  assert.equal(
    (await req("/api/mail/drafts/00000000-0000-0000-0000-000000000000", { s: A })).status,
    404,
  );
});

test("drafts: the body is never persisted anywhere", async () => {
  await callTool(
    "send_email",
    { account: "gmail", to: "dest@exemplo.test", subject: "s", body: BODY },
    agentCtx(A.id),
  );
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all()
    .map((r) => r.name);
  for (const t of tables) {
    const rows = db.prepare(`SELECT * FROM "${t}"`).all();
    assert.equal(JSON.stringify(rows).includes(BODY), false, `no body persisted in table ${t}`);
  }
});

// ---------- panel: list, cancel, states, CSRF, expiry, failure ----------

test("drafts: the panel lists only the caller's own drafts, with states and no body", async () => {
  const out = await callTool(
    "send_email",
    { account: "gmail", to: "lista@exemplo.test", subject: "Lista", body: BODY },
    agentCtx(A.id),
  );
  const id = draftId(out);
  const list = await json(await req("/api/mail/drafts", { s: A }));
  assert.equal(list.status, 200);
  const mine = list.body.find((d) => d.id === id);
  assert.ok(mine, "the caller's draft is listed");
  assert.equal(mine.state, "pending");
  assert.equal(mine.to, "lista@exemplo.test");
  assert.equal("body" in mine, false, "the list never carries the body");
  assert.equal(JSON.stringify(list.body).includes(BODY), false);
  const other = await json(await req("/api/mail/drafts", { s: B }));
  assert.equal(
    other.body.some((d) => d.id === id),
    false,
    "another admin never sees it",
  );
});

test("drafts: a draft can be cancelled, and a cancelled draft can never be sent", async () => {
  const out = await callTool(
    "send_email",
    { account: "gmail", to: "cancela@exemplo.test", subject: "s", body: BODY },
    agentCtx(A.id),
  );
  const id = draftId(out);
  assert.equal((await req(`/api/mail/drafts/${id}`, { method: "DELETE", s: A })).status, 200);
  const view = await json(await req(`/api/mail/drafts/${id}`, { s: A }));
  assert.equal(view.body.state, "cancelled");
  assert.equal(view.body.body, null, "the body is discarded on cancel");
  assert.equal(
    (
      await req(`/api/mail/drafts/${id}/send`, {
        method: "POST",
        body: { confirm: "ENVIAR" },
        s: A,
      })
    ).status,
    404,
  );
  assert.equal(
    (await req(`/api/mail/drafts/${id}`, { method: "DELETE", s: A })).status,
    404,
    "already cancelled",
  );
});

test("drafts: mutating draft routes require CSRF", async () => {
  const out = await callTool(
    "send_email",
    { account: "gmail", to: "csrf@exemplo.test", subject: "s", body: BODY },
    agentCtx(A.id),
  );
  const id = draftId(out);
  assert.equal(
    (await reqNoCsrf(`/api/mail/drafts/${id}/send`, { body: { confirm: "ENVIAR" }, s: A })).status,
    403,
  );
  assert.equal((await reqNoCsrf(`/api/mail/drafts/${id}`, { method: "DELETE", s: A })).status, 403);
});

test("drafts: an expired draft is reported as expired and cannot be sent", async () => {
  setDraftStore(createDraftStore({ ttlMs: 0 })); // every draft expires immediately
  try {
    const out = await callTool(
      "send_email",
      { account: "gmail", to: "exp@exemplo.test", subject: "s", body: BODY },
      agentCtx(A.id),
    );
    const id = draftId(out);
    const view = await json(await req(`/api/mail/drafts/${id}`, { s: A }));
    assert.equal(view.body.state, "expired");
    assert.equal(view.body.body, null, "expired drafts expose no body");
    assert.equal(
      (
        await req(`/api/mail/drafts/${id}/send`, {
          method: "POST",
          body: { confirm: "ENVIAR" },
          s: A,
        })
      ).status,
      404,
    );
  } finally {
    setDraftStore(createDraftStore());
  }
});

test("drafts: a transport failure is reported and the draft cannot be replayed", async () => {
  const out = await callTool(
    "send_email",
    { account: "gmail", to: "falha@exemplo.test", subject: "s", body: BODY },
    agentCtx(A.id),
  );
  const id = draftId(out);
  tstate.mode = "fail";
  const failed = await json(
    await req(`/api/mail/drafts/${id}/send`, { method: "POST", body: { confirm: "ENVIAR" }, s: A }),
  );
  tstate.mode = "ok";
  assert.equal(failed.status, 502);
  assert.equal(failed.body.error, "provider_error");
  const view = await json(await req(`/api/mail/drafts/${id}`, { s: A }));
  assert.equal(view.body.state, "failed");
  assert.equal(view.body.body, null, "the body is gone after the attempt");
  assert.equal(
    (
      await req(`/api/mail/drafts/${id}/send`, {
        method: "POST",
        body: { confirm: "ENVIAR" },
        s: A,
      })
    ).status,
    404,
    "no replay after failure",
  );
});

// ---------- titularidade (must run last: it deactivates A) ----------

test("titularidade: a deactivated admin's account stays with the owner and is not transferred", async () => {
  const settings = () =>
    db.prepare("SELECT data FROM admin_settings WHERE admin_id = ?").get(A.id)?.data || "";
  assert.match(settings(), /gmail/, "account exists before deactivation");
  assert.equal((await req(`/api/auth/admins/${A.id}`, { method: "DELETE", s: B })).status, 200);
  // B (active) cannot reach A's account; unknown and foreign are indistinguishable.
  assert.equal((await json(await req("/api/mail/gmail/messages", { s: B }))).status, 404);
  assert.equal(
    (await json(await req("/api/mail/gmail/messages", { s: B }))).body.error,
    "account_not_found",
  );
  assert.match(settings(), /gmail/, "account is NOT removed or transferred");
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM admin_settings WHERE admin_id = ?").get(B.id).n,
    1,
  );
  assert.equal(
    (
      db.prepare("SELECT data FROM admin_settings WHERE admin_id = ?").get(B.id).data || ""
    ).includes("gmail"),
    false,
    "never silently transferred to B",
  );
});

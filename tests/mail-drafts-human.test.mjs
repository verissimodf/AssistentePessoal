// P1-A remediação — rascunhos criados por HUMANOS na mesma store transiente (D9).
// Synthetic data + MOCK transport only: no network, no credentials, no real mailbox, no real send.
//
// Contrato novo exposto pelo painel:
//   POST /api/mail/drafts        {account,to,subject,body}  → cria rascunho transiente (dono) — NUNCA envia.
//   PUT  /api/mail/drafts/:id    {to,subject,body}          → edita enquanto `pending` — NUNCA envia.
// O rascunho continua single-use: envio só via POST /:id/send com confirm:"ENVIAR".
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-drafts-human-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
const { createApp } = await import("../server/index.js");
const { auth, db } = await import("../server/db.js");
const { setMailTransport } = await import("../server/mail-service.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const SECRET = "SENHA_APP_DRAFT_HUM_SONDA_41";
const BODY = "CORPO_HUMANO_PRIVADO_99";
let server, base;
const A = {},
  B = {};

const tstate = { sent: [], sendCalls: 0 };
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
    tstate.sendCalls += 1;
    tstate.sent.push(outgoing);
    return { messageId: "h1" };
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

// ---------- criação por humano ----------

test("human drafts: POST cria rascunho pendente, retorna id e expiração, e NUNCA envia", async () => {
  const r = await json(
    await req("/api/mail/drafts", {
      method: "POST",
      body: { account: "gmail", to: "parceiro@exemplo.test", subject: "Proposta", body: BODY },
      s: A,
    }),
  );
  assert.equal(r.status, 200);
  assert.ok(/^[0-9a-f-]{36}$/.test(r.body.id), "um id válido é retornado");
  assert.equal(r.body.state, "pending");
  assert.ok(r.body.expiresAt > Date.now(), "expiração futura");
  assert.equal(tstate.sendCalls, 0, "criar rascunho nunca envia");
  const view = await json(await req(`/api/mail/drafts/${r.body.id}`, { s: A }));
  assert.equal(view.status, 200);
  assert.equal(view.body.body, BODY);
  assert.equal(view.body.subject, "Proposta");
});

test("human drafts: POST exige sessão humana — bearer de serviço recebe 403", async () => {
  const tok = (
    await json(
      await req("/api/auth/tokens", {
        method: "POST",
        body: { name: "t", scopes: ["comms:read", "comms:send"] },
        s: A,
      }),
    )
  ).body.token;
  assert.equal(
    (
      await req("/api/mail/drafts", {
        method: "POST",
        body: { account: "gmail", to: "x@y.z", subject: "s", body: "b" },
        bearer: tok,
      })
    ).status,
    403,
  );
});

test("human drafts: POST sem CSRF é rejeitado", async () => {
  assert.equal(
    (
      await reqNoCsrf("/api/mail/drafts", {
        body: { account: "gmail", to: "x@y.z", subject: "s", body: "b" },
        s: A,
      })
    ).status,
    403,
  );
});

test("human drafts: POST valida campos — destinatário inválido e conta inexistente são 400", async () => {
  assert.equal(
    (
      await req("/api/mail/drafts", {
        method: "POST",
        body: { account: "gmail", to: "nao-email", subject: "s", body: "b" },
        s: A,
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await req("/api/mail/drafts", {
        method: "POST",
        body: { account: "conta-inexistente", to: "x@y.z", subject: "s", body: "b" },
        s: A,
      })
    ).status,
    400,
  );
});

// ---------- edição ----------

test("human drafts: PUT edita apenas rascunho pendente e persiste os novos valores", async () => {
  const r = await json(
    await req("/api/mail/drafts", {
      method: "POST",
      body: { account: "gmail", to: "original@exemplo.test", subject: "Original", body: BODY },
      s: A,
    }),
  );
  const id = r.body.id;
  const put = await json(
    await req(`/api/mail/drafts/${id}`, {
      method: "PUT",
      body: { to: "editado@exemplo.test", subject: "Revisado", body: "Corpo revisado." },
      s: A,
    }),
  );
  assert.equal(put.status, 200);
  const view = await json(await req(`/api/mail/drafts/${id}`, { s: A }));
  assert.equal(view.body.to, "editado@exemplo.test");
  assert.equal(view.body.subject, "Revisado");
  assert.equal(view.body.body, "Corpo revisado.");
});

test("human drafts: PUT em rascunho terminal/estrangeiro/ausente é 404 e não edita nada", async () => {
  const r = await json(
    await req("/api/mail/drafts", {
      method: "POST",
      body: { account: "gmail", to: "z@exemplo.test", subject: "s", body: BODY },
      s: A,
    }),
  );
  const id = r.body.id;
  await req(`/api/mail/drafts/${id}`, { method: "DELETE", s: A }); // cancela → terminal
  assert.equal(
    (
      await req(`/api/mail/drafts/${id}`, {
        method: "PUT",
        body: { to: "x@y.z", subject: "s", body: "b" },
        s: A,
      })
    ).status,
    404,
  );
  // Outro admin: indistinguível de inexistente.
  const other = await json(
    await req("/api/mail/drafts", {
      method: "POST",
      body: { account: "outlook", to: "b@exemplo.test", subject: "s", body: "b" },
      s: B,
    }),
  );
  assert.equal(
    (
      await req(`/api/mail/drafts/${other.body.id}`, {
        method: "PUT",
        body: { to: "x@y.z", subject: "s", body: "b" },
        s: A,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await req("/api/mail/drafts/00000000-0000-0000-0000-000000000000", {
        method: "PUT",
        body: { to: "x@y.z", subject: "s", body: "b" },
        s: A,
      })
    ).status,
    404,
  );
});

test("human drafts: rascunho humano segue o ciclo completo — revisão, envio confirmado, single-use", async () => {
  const r = await json(
    await req("/api/mail/drafts", {
      method: "POST",
      body: { account: "gmail", to: "ciclo@exemplo.test", subject: "Ciclo", body: BODY },
      s: A,
    }),
  );
  const id = r.body.id;
  assert.equal(
    (await json(await req(`/api/mail/drafts/${id}/send`, { method: "POST", body: {}, s: A }))).body
      .error,
    "confirmation_required",
  );
  const sent = await json(
    await req(`/api/mail/drafts/${id}/send`, { method: "POST", body: { confirm: "ENVIAR" }, s: A }),
  );
  assert.equal(sent.status, 200);
  assert.deepEqual(tstate.sent.at(-1), { to: "ciclo@exemplo.test", subject: "Ciclo", text: BODY });
  assert.equal(
    (
      await req(`/api/mail/drafts/${id}/send`, {
        method: "POST",
        body: { confirm: "ENVIAR" },
        s: A,
      })
    ).status,
    404,
    "single-use: sem reenvio",
  );
});

// ---------- sigilo ----------

test("human drafts: audit e resposta nunca expõem corpo ou credencial", async () => {
  const r = await json(
    await req("/api/mail/drafts", {
      method: "POST",
      body: { account: "gmail", to: "sigilo@exemplo.test", subject: "Sigilo", body: BODY },
      s: A,
    }),
  );
  assert.equal(JSON.stringify(r.body).includes(BODY), false, "sem corpo na resposta de criação");
  const audit = auditText();
  assert.equal(audit.includes(BODY), false, "sem corpo no audit");
  assert.equal(audit.includes(SECRET), false, "sem credencial no audit");
  assert.equal(audit.includes("sigilo@exemplo.test"), false, "sem destinatário no audit");
});

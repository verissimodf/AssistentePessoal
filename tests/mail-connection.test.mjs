// P1-B remediação — teste de conexão IMAP/SMTP (endpoint autenticado, sem enviar e-mail).
// Clientes IMAP/SMTP INJETÁVEIS: nenhum socket, nenhuma credencial real, nenhum envio.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-mail-conn-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
const { createApp } = await import("../server/index.js");
const { auth, db } = await import("../server/db.js");
const { setMailTransport } = await import("../server/mail-service.js");
const { createImapSmtpTransport, DEFAULT_HOSTS } = await import("../server/mail-imap.js");
const { classifyConnectionReason } = await import("../server/mail.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const SECRET = "SENHA_APP_CONN_SONDA_88";
let server, base;
const A = {},
  B = {};

// ---- cliente SMTP/IMAP injetável (nenhum socket) ----
const conn = { imapMode: "ok", smtpMode: "ok", imapCalls: 0, smtpVerifyCalls: 0, sent: 0 };

/** Fábrica de cliente IMAP falsa: connect/getMailboxLock/logout sem rede. */
const fakeImapClient = async () => {
  conn.imapCalls += 1;
  return {
    async connect() {
      if (conn.imapMode === "auth")
        throw Object.assign(new Error("Invalid login 535"), { code: "EAUTH" });
      if (conn.imapMode === "dns")
        throw Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
      if (conn.imapMode === "timeout")
        throw Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
      if (conn.imapMode === "tls")
        throw Object.assign(new Error("self-signed certificate"), { code: "CERT_HAS_EXPIRED" });
    },
    async getMailboxLock() {
      return { release() {} };
    },
    async logout() {},
    close() {},
  };
};
/** Fábrica de transporte SMTP falsa: verify() autentica SEM enviar. */
const fakeSmtpFactory = async () => ({
  async verify() {
    conn.smtpVerifyCalls += 1;
    if (conn.smtpMode === "auth")
      throw Object.assign(new Error("535 auth failed"), { code: "EAUTH" });
    if (conn.smtpMode === "timeout")
      throw Object.assign(new Error("timeout"), { code: "ETIMEDOUT" });
  },
  async sendMail() {
    conn.sent += 1; // nunca deve acontecer em um teste de conexão
    return { messageId: "nunca" };
  },
  close() {},
});

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
const reqNoCsrf = (path, { body, s } = {}) =>
  fetch(base + path, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json", cookie: s.cookie },
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
const testConn = (path, opts) => req(path, { method: "POST", body: {}, ...opts });

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
  // A: conta completa; B: conta sem credenciais (configuração incompleta).
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
        body: { comms: { outlook: { enabled: true } } },
        s: B,
      })
    ).status,
    200,
  );
});
after(() => server.close());

// ---------- taxonomia pura (sem sockets) ----------

test("connection: classifica DNS, timeout, TLS, autenticação e inalcançável sem vazar a mensagem", () => {
  assert.equal(classifyConnectionReason({ code: "ENOTFOUND" }), "dns");
  assert.equal(classifyConnectionReason({ code: "EAI_AGAIN" }), "dns");
  assert.equal(classifyConnectionReason({ code: "ETIMEDOUT" }), "timeout");
  assert.equal(classifyConnectionReason({ code: "EAUTH" }), "auth");
  assert.equal(classifyConnectionReason({ code: "CERT_HAS_EXPIRED" }), "tls");
  assert.equal(classifyConnectionReason({ code: "ECONNREFUSED" }), "unreachable");
  assert.equal(classifyConnectionReason({ message: `falha com ${SECRET}` }), "unknown");
  // A razão é um rótulo curto: nunca contém a mensagem original nem segredos.
  for (const e of [{ code: "EAUTH" }, { message: SECRET }]) {
    assert.equal(String(classifyConnectionReason(e)).includes(SECRET), false);
  }
});

// ---------- autorização ----------

test("connection: exige sessão humana, CSRF e respeita ownership", async () => {
  assert.equal((await testConn("/api/mail/gmail/test-connection")).status, 401);
  assert.equal((await reqNoCsrf("/api/mail/gmail/test-connection", { s: A })).status, 403);
  const tok = (
    await json(
      await req("/api/auth/tokens", {
        method: "POST",
        body: { name: "t", scopes: ["comms:read"] },
        s: A,
      }),
    )
  ).body.token;
  assert.equal((await testConn("/api/mail/gmail/test-connection", { bearer: tok })).status, 403);
  // A conta de B não é acessível por A (indistinguível de inexistente).
  const foreign = await json(await testConn("/api/mail/outlook/test-connection", { s: A }));
  assert.equal(foreign.status, 404);
  assert.equal(foreign.body.error, "account_not_found");
});

test("connection: conta inexistente e provedor não suportado são erro de validação (400)", async () => {
  const r = await json(await testConn("/api/mail/naoexiste/test-connection", { s: A }));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "invalid_account");
});

test("connection: configuração incompleta é erro de validação, não 500", async () => {
  const r = await json(await testConn("/api/mail/outlook/test-connection", { s: B }));
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "incomplete_config");
});

// ---------- mock por padrão ----------

test("connection: com o transporte mock o resultado é explicitamente 'mock' (nunca 'validada')", async () => {
  const r = await json(await testConn("/api/mail/gmail/test-connection", { s: A }));
  assert.equal(r.status, 200);
  assert.equal(r.body.mode, "mock");
  // O mock não pode atestar conexão real: o estado é 'unsupported', jamais 'connected'.
  assert.equal(r.body.imap.state, "unsupported");
  assert.equal(r.body.smtp.state, "unsupported");
  assert.notEqual(r.body.imap.ok, true, "mock nunca é prova de conexão real");
  assert.equal(JSON.stringify(r.body).includes(SECRET), false, "nunca expõe a app password");
});

// ---------- caminho real com clientes injetáveis ----------

test("connection: sucesso IMAP+SMTP marca 'connected' e NUNCA envia e-mail", async () => {
  setMailTransport(
    createImapSmtpTransport({
      createImapClient: fakeImapClient,
      createSmtpTransport: fakeSmtpFactory,
    }),
  );
  conn.imapMode = "ok";
  conn.smtpMode = "ok";
  conn.sent = 0;
  const r = await json(await testConn("/api/mail/gmail/test-connection", { s: A }));
  assert.equal(r.status, 200);
  assert.equal(r.body.mode, "imap");
  assert.equal(r.body.imap.ok, true);
  assert.equal(r.body.imap.state, "connected");
  assert.equal(r.body.smtp.ok, true);
  assert.equal(r.body.smtp.state, "connected");
  assert.equal(conn.sent, 0, "um teste de conexão nunca envia");
  assert.equal(conn.smtpVerifyCalls, 1, "SMTP é validado por verify(), não por envio");
});

test("connection: falha de autenticação é classificada como 'auth' sem expor credenciais", async () => {
  conn.imapMode = "auth";
  conn.smtpMode = "auth";
  const r = await json(await testConn("/api/mail/gmail/test-connection", { s: A }));
  assert.equal(r.status, 200, "falha de conexão é um RESULTADO do teste, não erro do servidor");
  assert.equal(r.body.imap.ok, false);
  assert.equal(r.body.imap.reason, "auth");
  assert.equal(r.body.smtp.reason, "auth");
  assert.equal(JSON.stringify(r.body).includes(SECRET), false);
  conn.imapMode = "ok";
  conn.smtpMode = "ok";
});

test("connection: distingue DNS, timeout e TLS", async () => {
  for (const [mode, reason] of [
    ["dns", "dns"],
    ["timeout", "timeout"],
    ["tls", "tls"],
  ]) {
    conn.imapMode = mode;
    const r = await json(await testConn("/api/mail/gmail/test-connection", { s: A }));
    assert.equal(r.body.imap.ok, false);
    assert.equal(r.body.imap.reason, reason, `modo ${mode} → ${reason}`);
  }
  conn.imapMode = "ok";
});

test("connection: falha global do transporte não derruba a rota (200 com ambos os canais em erro)", async () => {
  setMailTransport({
    kind: "imap",
    async verify() {
      throw Object.assign(new Error("boom"), { code: "ENOTFOUND" });
    },
    async list() {
      return { messages: [], total: 0 };
    },
    async read() {
      return {};
    },
    async search() {
      return { messages: [], total: 0 };
    },
    async send() {
      return {};
    },
  });
  const r = await json(await testConn("/api/mail/gmail/test-connection", { s: A }));
  assert.equal(r.status, 200);
  assert.equal(r.body.imap.ok, false);
  assert.equal(r.body.smtp.ok, false);
  assert.equal(r.body.imap.reason, "dns");
  // Restaura o mock para os testes seguintes.
  setMailTransport(undefined);
});

test("connection: o endpoint não existe para transporte que não sabe verificar (modo explícito)", async () => {
  setMailTransport({
    kind: "custom",
    async list() {
      return { messages: [], total: 0 };
    },
    async read() {
      return {};
    },
    async search() {
      return { messages: [], total: 0 };
    },
    async send() {
      return {};
    },
  });
  const r = await json(await testConn("/api/mail/gmail/test-connection", { s: A }));
  assert.equal(r.status, 200);
  assert.equal(r.body.mode, "custom");
  assert.equal(r.body.imap.state, "unsupported");
  setMailTransport(undefined);
});

test("connection: hosts padrão cobrem gmail e outlook (sem expor credenciais)", () => {
  assert.deepEqual(Object.keys(DEFAULT_HOSTS).sort(), ["gmail", "outlook"]);
  assert.equal(JSON.stringify(DEFAULT_HOSTS).includes(SECRET), false);
});

test("connection: audit registra o teste sem corpo nem credencial", () => {
  const audit = JSON.stringify(db.prepare("SELECT kind, detail FROM audit").all());
  assert.equal(audit.includes(SECRET), false);
  assert.equal(audit.includes("ana@exemplo.test"), false);
});

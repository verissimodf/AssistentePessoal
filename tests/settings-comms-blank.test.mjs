// P3 remediação — contas de comunicação: campo em branco NUNCA apaga o valor salvo em silêncio,
// e segredos nunca retornam ao cliente (apenas o indicador `hasKey`).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-comms-blank-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
const { createApp } = await import("../server/index.js");
const { auth } = await import("../server/db.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const SECRET = "SENHA_APP_BLANK_SONDA_77";
let server, base;
const A = {};

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
const settings = async () => (await json(await req("/api/settings", { s: A }))).body;

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  const r = await req("/api/auth/login", { method: "POST", body: { username: "ana", password: PW } });
  const j = await r.json();
  Object.assign(A, { cookie: r.headers.get("set-cookie").split(";")[0], csrf: j.csrf, id: j.admin.id });
  assert.equal(
    (
      await req("/api/settings", {
        method: "PUT",
        body: { comms: { gmail: { enabled: true, user: "ana@exemplo.test", appPassword: SECRET } } },
        s: A,
      })
    ).status,
    200,
  );
});
after(() => server.close());

test("comms: segredo nunca retorna ao cliente — apenas hasKey", async () => {
  const s = await settings();
  assert.equal(s.comms.gmail.appPassword, "", "segredo sai mascarado");
  assert.equal(s.comms.gmail.hasKey, true, "indicador seguro de que existe segredo");
  assert.equal(JSON.stringify(s).includes(SECRET), false, "nunca ecoa o segredo");
  // o usuário (não-secreto) permanece visível para o operador conferir a conta
  assert.equal(s.comms.gmail.user, "ana@exemplo.test");
});

test("comms: campo em branco preserva o usuário salvo (não apaga em silêncio)", async () => {
  const r = await json(await req("/api/settings", { method: "PUT", body: { comms: { gmail: { user: "" } } }, s: A }));
  assert.equal(r.status, 200);
  assert.equal(r.body.comms.gmail.user, "ana@exemplo.test", "usuário preservado");
  assert.equal((await settings()).comms.gmail.user, "ana@exemplo.test");
});

test("comms: campo em branco preserva o segredo salvo", async () => {
  const r = await json(
    await req("/api/settings", { method: "PUT", body: { comms: { gmail: { appPassword: "   " } } }, s: A }),
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.comms.gmail.hasKey, true, "segredo continua salvo");
});

test("comms: valor novo substitui o anterior (a atualização explícita funciona)", async () => {
  const r = await json(
    await req("/api/settings", {
      method: "PUT",
      body: { comms: { gmail: { user: "novo@exemplo.test", appPassword: "OUTRO_SEGREDO_88" } } },
      s: A,
    }),
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.comms.gmail.user, "novo@exemplo.test");
  assert.equal(r.body.comms.gmail.appPassword, "", "segue mascarado");
  assert.equal(r.body.comms.gmail.hasKey, true);
  assert.equal(JSON.stringify(r.body).includes("OUTRO_SEGREDO_88"), false);
});

test("comms: desabilitar a conta é a remoção explícita (credenciais preservadas, uso desativado)", async () => {
  const r = await json(
    await req("/api/settings", { method: "PUT", body: { comms: { gmail: { enabled: false } } }, s: A }),
  );
  assert.equal(r.status, 200);
  assert.equal(r.body.comms.gmail.enabled, false, "conta desativada de forma explícita");
  assert.equal(r.body.comms.gmail.user, "novo@exemplo.test", "usuário não é apagado");
  assert.equal(r.body.comms.gmail.hasKey, true, "segredo não é apagado");
});

// Fase G — troca de senha do próprio administrador: sessão + CSRF obrigatórios, política de senha
// reutilizada (scrypt existente), revogação das DEMAIS sessões, auditoria sem credenciais e
// nenhuma alteração em agentes, memórias, tokens, configurações ou propriedade.
// Banco TEMPORÁRIO (JARVIS_DATA_DIR): nunca toca o banco ativo. Senhas abaixo são apenas de teste.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-pwchange-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { auth, db, agents } = await import("../server/db.js");
const { verifyPassword } = await import("../server/auth.js");
const { createApp } = await import("../server/index.js");

const PW = "senha-atual-forte-1";
const PW2 = "senha-nova-muito-forte-2";
const ORIGIN = "http://localhost:8080";
let server, base, adminId, S1, S2;

const req = (path, { method = "GET", body, s, csrf = true, token } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(s ? { cookie: s.cookie, ...(csrf ? { "x-jarvis-csrf": s.csrf } : {}) } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

const login = async (username, password) => {
  const r = await req("/api/auth/login", { method: "POST", body: { username, password } });
  const j = await r.json();
  return {
    status: r.status,
    body: j,
    s: { cookie: (r.headers.get("set-cookie") || "").split(";")[0], csrf: j.csrf },
  };
};
const change = (s, body, csrf = true) =>
  req("/api/auth/password", { method: "POST", body, s, csrf });

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  adminId = db.prepare("SELECT id FROM admins WHERE active = 1").get().id;
  // Dados que NÃO podem ser tocados pela troca de senha.
  agents.save({
    id: "a1",
    name: "Auxiliar",
    provider: "ollama",
    model: "qwen2.5:7b",
    tools: ["remember"],
  });
  db.prepare(
    "INSERT INTO memories (id, content, tags, created_at) VALUES ('m1', 'nota', '', ?)",
  ).run(new Date().toISOString());
  S1 = (await login("ana", PW)).s;
  S2 = (await login("ana", PW)).s;
});
after(async () => {
  await new Promise((r) => server.close(r));
});

test("sem sessão: troca recusada (401)", async () => {
  const r = await req("/api/auth/password", {
    method: "POST",
    body: { currentPassword: PW, newPassword: PW2, confirmPassword: PW2 },
  });
  assert.equal(r.status, 401);
});

test("com sessão mas sem CSRF: recusada (403) e auditada como csrf_rejected", async () => {
  const r = await change(
    S1,
    { currentPassword: PW, newPassword: PW2, confirmPassword: PW2 },
    false,
  );
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, "csrf");
  assert.ok(
    db.prepare("SELECT 1 FROM audit WHERE kind='authz.csrf_rejected'").get(),
    "recusa de CSRF auditada",
  );
});

test("senha nova fora da política: recusada (400 weak_password)", async () => {
  const r = await change(S1, {
    currentPassword: PW,
    newPassword: "curta-12345",
    confirmPassword: "curta-12345",
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, "weak_password");
});

test("confirmação divergente: recusada (400 password_mismatch)", async () => {
  const r = await change(S1, {
    currentPassword: PW,
    newPassword: PW2,
    confirmPassword: PW2 + "-x",
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, "password_mismatch");
});

test("senha atual incorreta: recusada (403 reauth_failed)", async () => {
  const r = await change(S1, {
    currentPassword: "senha-errada-mesmo",
    newPassword: PW2,
    confirmPassword: PW2,
  });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, "reauth_failed");
});

test("após as recusas, a senha original continua valendo (e a sessão extra é encerrada)", async () => {
  const l = await login("ana", PW);
  assert.equal(l.status, 200);
  const out = await req("/api/auth/logout", { method: "POST", body: {}, s: l.s });
  assert.equal(out.status, 200);
});

test("troca válida: 200, revoga as OUTRAS sessões (1) e mantém a atual", async () => {
  const r = await change(S1, { currentPassword: PW, newPassword: PW2, confirmPassword: PW2 });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.sessionsRevoked, 1, "apenas a outra sessão do mesmo administrador foi revogada");
});

test("a outra sessão do mesmo administrador foi invalidada; a atual continua", async () => {
  const gone = await req("/api/auth/me", { s: S2 });
  assert.equal(gone.status, 401);
  const goneWrite = await req("/api/memories", { method: "POST", body: { content: "x" }, s: S2 });
  assert.equal(goneWrite.status, 401, "sessão revogada não escreve, nem com o CSRF antigo");
  const me = await req("/api/auth/me", { s: S1 });
  assert.equal(me.status, 200, "a sessão que trocou continua válida");
  const reauth = await req("/api/auth/reauth", { method: "POST", body: { password: PW2 }, s: S1 });
  assert.equal(reauth.status, 200, "o servidor já verifica a senha nova");
});

test("hash armazenado é scrypt; verifica a nova senha e rejeita a antiga (sem texto claro)", () => {
  const stored = db
    .prepare("SELECT password_hash FROM admins WHERE id = ?")
    .get(adminId).password_hash;
  assert.equal(stored.startsWith("scrypt$"), true);
  assert.equal(verifyPassword(PW2, stored), true);
  assert.equal(verifyPassword(PW, stored), false);
});

test("login com a nova senha funciona; com a anterior, é rejeitado", async () => {
  const ok = await login("ana", PW2);
  assert.equal(ok.status, 200);
  const old = await login("ana", PW);
  assert.equal(old.status, 401);
  assert.equal(old.body.error, "invalid_credentials");
});

test("cookie de sessão fabricado é recusado (401)", async () => {
  const r = await req("/api/auth/password", {
    method: "POST",
    body: {
      currentPassword: PW2,
      newPassword: "outra-senha-muito-forte-3",
      confirmPassword: "outra-senha-muito-forte-3",
    },
    s: { cookie: "jarvis_sid=jss_fabricado", csrf: "x" },
  });
  assert.equal(r.status, 401);
});

test("token de serviço (mesmo com escopos amplos) não troca senha (403)", async () => {
  const t = await (
    await req("/api/auth/tokens", {
      method: "POST",
      body: { name: "sonda", scopes: ["chat", "settings:write", "memories:read"] },
      s: S1,
    })
  ).json();
  assert.ok(t.token);
  const r = await req("/api/auth/password", {
    method: "POST",
    body: {
      currentPassword: PW2,
      newPassword: "outra-senha-muito-forte-3",
      confirmPassword: "outra-senha-muito-forte-3",
    },
    token: t.token,
  });
  assert.equal(r.status, 403);
  assert.equal((await r.json()).error, "forbidden");
});

test("auditoria: eventos sem senha/hash; recusas com motivo, nunca credencial", async () => {
  const rows = db.prepare("SELECT kind, detail FROM audit").all();
  const changed = rows.filter((r) => r.kind === "auth.password_changed");
  assert.equal(changed.length, 1);
  const detail = JSON.parse(changed[0].detail);
  assert.equal(detail.admin, adminId);
  assert.equal(detail.count, 1);
  const denied = rows
    .filter((r) => r.kind === "auth.password_change_denied")
    .map((r) => JSON.parse(r.detail));
  assert.deepEqual(denied.map((d) => d.reason).sort(), ["reauth_failed", "weak_password"]);
  const all = rows.map((r) => `${r.kind} ${r.detail}`).join("\n");
  for (const secret of [PW, PW2, "senha-errada-mesmo", "scrypt"]) {
    assert.equal(all.includes(secret), false, `auditoria não pode conter "${secret.slice(0, 6)}…"`);
  }
  const http = await (await req("/api/audit", { s: S1 })).text();
  for (const secret of [PW, PW2, "scrypt"]) assert.equal(http.includes(secret), false);
});

test("nem agentes, memórias, tokens, configurações ou propriedade foram alterados", () => {
  assert.equal(db.prepare("SELECT COUNT(*) n FROM memories").get().n, 1);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM agents").get().n, 1);
  assert.deepEqual(
    JSON.parse(db.prepare("SELECT data FROM agents WHERE id='a1'").get().data).tools,
    ["remember"],
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM ownership").get().n,
    0,
    "trocar senha não cria nem reivindica recursos",
  );
  assert.equal(db.prepare("SELECT COUNT(*) n FROM documents").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM approvals").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM kv").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM legacy_settings").get().n, 0);
  // Apenas o token-sonda criado explicitamente pelo teste de token existe.
  assert.equal(db.prepare("SELECT COUNT(*) n FROM service_tokens").get().n, 1);
});

// P0.2 — Foco da sessão (objetivo/resumo/decisões) persistido POR DONO.
//
// Regras sob teste:
//   - a migração v11 cria `session_focus` e o esquema sobe para 11 (backup verificado + txn);
//   - sem registro → estado explícito vazio, nunca um objetivo inventado;
//   - escrita/leitura são do administrador DA SESSÃO: sem leitura cruzada entre donos;
//   - limites de tamanho e formato são rejeitados com 400 (nunca truncados em silêncio);
//   - anônimo → 401 e cookie sem CSRF → 403 (mesma barreira das demais rotas mutantes);
//   - a auditoria registra a escrita SEM o texto (privacidade do administrador).
// Banco TEMPORÁRIO; nenhuma rede externa.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-sessionfocus-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { auth, db } = await import("../server/db.js");
const { createApp } = await import("../server/index.js");
const { LIMITS, emptyFocus, getSessionFocus, updateSessionFocus } =
  await import("../server/session-focus.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";

let server, base, A, B;

const login = async (username, password) => {
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  assert.equal(r.status, 200, `login ${username}`);
  const sid = r.headers.get("set-cookie").split(";")[0].split("=")[1];
  return { principal: auth.validateSession(sid), cookie: `jarvis_sid=${sid}`, sid };
};

const get = (sess, path = "/api/session-focus") =>
  fetch(`${base}${path}`, { headers: { origin: ORIGIN, cookie: sess.cookie } });

const put = (sess, body, { csrf = true, path = "/api/session-focus" } = {}) =>
  fetch(`${base}${path}`, {
    method: "PUT",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      cookie: sess.cookie,
      ...(csrf ? { "x-jarvis-csrf": sess.principal.csrf } : {}),
    },
    body: JSON.stringify(body),
  });

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  A = await login("ana", PW);
  // Segundo administrador exige a senha atual do primeiro (fluxo de dupla aprovação).
  const r = await fetch(`${base}/api/auth/admins`, {
    method: "POST",
    headers: {
      origin: ORIGIN,
      "content-type": "application/json",
      cookie: A.cookie,
      "x-jarvis-csrf": A.principal.csrf,
    },
    body: JSON.stringify({ username: "bia", password: PW, currentPassword: PW }),
  });
  assert.equal(r.status, 200, "criação do 2º admin");
  B = await login("bia", PW);
});

after(() => server.close());

test("migração v11 aplicada: session_focus existe e o esquema é 11", () => {
  assert.ok(db.prepare("PRAGMA user_version").get().user_version >= 11);
  assert.ok(
    db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='session_focus'").get(),
    "tabela criada",
  );
  assert.equal(db.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
});

test("sem registro → estado vazio explícito (nada é inventado)", async () => {
  const r = await get(A);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(body, emptyFocus());
  assert.equal(body.objective, "");
  assert.deepEqual(body.decisions, []);
  assert.equal(body.updatedAt, null);
});

test("gravar e reler: persiste por dono e devolve o que foi gravado", async () => {
  const payload = {
    objective: "Revisar o P0.2 e publicar o relatório",
    summary: "Verificadores e metadados de build entregues; validação de produção pendente.",
    decisions: ["Commit só via --build-arg GIT_SHA", "2xx isolado nunca é verified"],
  };
  const w = await put(A, payload);
  assert.equal(w.status, 200);
  const saved = await w.json();
  assert.equal(saved.objective, payload.objective);
  assert.equal(saved.summary, payload.summary);
  assert.deepEqual(saved.decisions, payload.decisions);
  assert.ok(saved.updatedAt, "carimbo de tempo gravado");

  const reread = await (await get(A)).json();
  assert.deepEqual(reread, saved, "sobrevive à releitura");
});

test("isolamento por dono: o segundo admin não lê nem sobrescreve o foco do primeiro", async () => {
  const bView = await (await get(B)).json();
  assert.deepEqual(bView, emptyFocus(), "foco do A não vaza para B");

  await put(B, { objective: "Foco da Bia", summary: "", decisions: [] });
  const aView = await (await get(A)).json();
  assert.notEqual(aView.objective, "Foco da Bia", "A mantém o próprio foco");
  assert.equal(aView.objective, "Revisar o P0.2 e publicar o relatório");

  const rows = db.prepare("SELECT admin_id FROM session_focus ORDER BY admin_id").all();
  assert.equal(rows.length, 2, "uma linha por dono");
});

test("limites: texto acima do máximo é rejeitado com 400, nunca truncado", async () => {
  const long = await put(A, { objective: "x".repeat(LIMITS.objective + 1) });
  assert.equal(long.status, 400);
  const longSum = await put(A, { summary: "y".repeat(LIMITS.summary + 1) });
  assert.equal(longSum.status, 400);
  const many = await put(A, {
    decisions: Array.from({ length: LIMITS.decisions + 1 }, (_, i) => `d${i}`),
  });
  assert.equal(many.status, 400);
  const notArray = await put(A, { decisions: "não é lista" });
  assert.equal(notArray.status, 400);

  const after = await (await get(A)).json();
  assert.equal(after.objective, "Revisar o P0.2 e publicar o relatório", "estado anterior intacto");
});

test("barreras: anônimo → 401; cookie sem CSRF → 403", async () => {
  const anon = await fetch(`${base}/api/session-focus`, { headers: { origin: ORIGIN } });
  assert.equal(anon.status, 401);
  const anonPut = await fetch(`${base}/api/session-focus`, {
    method: "PUT",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ objective: "forjado" }),
  });
  assert.equal(anonPut.status, 401);
  const noCsrf = await put(A, { objective: "sem csrf" }, { csrf: false });
  assert.equal(noCsrf.status, 403);
});

test("auditoria registra a escrita SEM o texto do administrador", async () => {
  const rows = db
    .prepare("SELECT kind, detail FROM audit WHERE kind = 'session_focus.updated' ORDER BY id")
    .all();
  assert.ok(rows.length >= 1, "escrita auditada");
  const all = rows.map((r) => `${r.kind} ${r.detail}`).join("\n");
  assert.ok(!all.includes("Revisar o P0.2"), "objetivo não vai para a auditoria");
  assert.ok(!all.includes("Foco da Bia"), "foco do outro dono não vai para a auditoria");
  const last = JSON.parse(rows.at(-1).detail);
  assert.equal(typeof last.admin, "string", "dono identificado");
  assert.equal(typeof last.count, "number", "apenas contagem");
});

test("módulo: estado parcial vira string vazia e decisão malformada é descartada", () => {
  assert.deepEqual(emptyFocus(), { objective: "", summary: "", decisions: [], updatedAt: null });
  const saved = updateSessionFocus(A.principal.adminId, {
    objective: "  limpo  ",
    decisions: [42, "  ok  ", ""],
  });
  assert.equal(saved.objective, "limpo", "trim nas pontas");
  assert.deepEqual(saved.decisions, ["ok"], "entradas vazias/não-texto descartadas");
  assert.deepEqual(
    getSessionFocus(null),
    emptyFocus(),
    "sem dono não há foco (nunca um valor herdado)",
  );
});

// P0.2 — Semântica dos verificadores de PÓS-CONDIÇÃO.
//
// Regra sob teste: `verified` SÓ quando um verificador adequado à operação comprovou a pós-condição.
// HTTP 2xx, exit 0, mensagem de sucesso do provedor ou existência de arquivo isoladamente NUNCA
// provam o objetivo. Falha comprovada → `failed`; impossível determinar → `unknown`.
// Banco TEMPORÁRIO; `fetch` substituído por duplo controlado — nenhuma mensagem real é enviada.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-verif-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { auth, db, listEvidence, EVIDENCE_VERIFICATIONS, EVIDENCE_STATES } =
  await import("../server/db.js");
const { createApp } = await import("../server/index.js");
const { callTool, resolveApproval, evidenceFor, classifyOutcome } =
  await import("../server/tools.js");
const { updateSettings, getSettings } = await import("../server/settings.js");
const { sendMessage } = await import("../server/comms.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const CORR = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

let server, base, realFetch;
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
const ctx = () => ({ autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR });
// O `setHost` usa HTTP real — precisa do `fetch` original (testes vizinhos instalam mocks de
// provedor no globalThis.fetch e devolvem status sintéticos).
const setHost = async (allowlist) => {
  globalThis.fetch = realFetch;
  const r = await req("/api/settings", {
    method: "PUT",
    body: { host: { enabled: true, allowlist } },
    s: A,
  });
  assert.equal(r.status, 200, `PUT de settings falhou: ${r.status} ${await r.text()}`);
  const eff = getSettings(A.adminId).host;
  assert.equal(eff.enabled, true, `host efetivo não aplicado: ${JSON.stringify(eff)}`);
  assert.equal(eff.allowlist, allowlist, `allowlist efetiva: ${JSON.stringify(eff)}`);
};

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  const r = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { origin: ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ username: "ana", password: PW }),
  });
  assert.equal(r.status, 200);
  const sid = r.headers.get("set-cookie").split(";")[0].split("=")[1];
  A.principal = auth.validateSession(sid);
  assert.ok(A.principal, "sessão real (anti-forja por WeakMap)");
  A.cookie = `jarvis_sid=${sid}`;
  A.csrf = (await r.json()).csrf;
  A.adminId = db.prepare("SELECT id FROM admins WHERE active=1").get().id;
  realFetch = globalThis.fetch;
});

after(() => {
  globalThis.fetch = realFetch;
  server.close();
});

// ---------- conjuntos fechados ----------
test("EVIDENCE_VERIFICATIONS cobre verified/unverified/failed/unknown", () => {
  for (const v of ["verified", "unverified", "failed", "unknown"])
    assert.ok(EVIDENCE_VERIFICATIONS.has(v), v);
  assert.ok(EVIDENCE_STATES.has("failed"));
});

// ---------- evidenceFor: semântica por operação ----------
test("shell concluído → unverified/exit_code (exit 0 nunca prova o objetivo)", () => {
  const ev = evidenceFor(
    "run_command",
    { state: "completed", exitCode: 0, output: "ok" },
    "confirmed",
  );
  assert.deepEqual(
    [ev.state, ev.verification, ev.verifiedBy],
    ["completed", "unverified", "exit_code"],
  );
});

test("shell com falha → failed/exit_code (evidência de falha da operação)", () => {
  const ev = evidenceFor("run_command", { state: "failed", exitCode: 1, output: "" }, "failed");
  assert.deepEqual([ev.state, ev.verification, ev.verifiedBy], ["failed", "failed", "exit_code"]);
});

test("shell com erro de lançamento → failed/exception (state preservado)", () => {
  const ev = evidenceFor("run_command", { state: "error", exitCode: null, output: "" }, "failed");
  assert.deepEqual([ev.state, ev.verification, ev.verifiedBy], ["error", "failed", "exception"]);
});

test("timeout/overflow → unknown (o efeito externo pode ter ocorrido)", () => {
  for (const state of ["timeout", "overflow"]) {
    const ev = evidenceFor("run_command", { state, exitCode: null, output: "" }, "unknown");
    assert.deepEqual([ev.verification, ev.verifiedBy], ["unknown", state]);
  }
});

test("não executado (negado) → unknown/not_executed, nunca verificado", () => {
  const ev = evidenceFor("send_message", { output: "Negado pelo usuário." }, "denied");
  assert.deepEqual(
    [ev.state, ev.verification, ev.verifiedBy],
    ["denied", "unknown", "not_executed"],
  );
});

test("verificador COMPROVADO (ok:true) → verified", () => {
  const ev = evidenceFor(
    "send_message",
    { output: "Enviado no Telegram.", verify: { verifier: "provider_message_id", ok: true } },
    "confirmed",
  );
  assert.deepEqual([ev.verification, ev.verifiedBy], ["verified", "provider_message_id"]);
});

test("verificador INCOMPLETO (ok:false) → unverified, mesmo com 'sucesso' textual", () => {
  const ev = evidenceFor(
    "send_message",
    { output: "Enviado no Telegram.", verify: { verifier: "http_status", ok: false } },
    "confirmed",
  );
  assert.deepEqual([ev.verification, ev.verifiedBy], ["unverified", "http_status"]);
});

test("sem verificador declarado → unverified/contract_text, NUNCA verified", () => {
  const ev = evidenceFor("alguma_ferramenta", { output: "Feito com sucesso." }, "confirmed");
  assert.deepEqual([ev.verification, ev.verifiedBy], ["unverified", "contract_text"]);
});

test("resultado falho com verificador → failed", () => {
  const ev = evidenceFor(
    "send_message",
    { output: "Telegram 400", verify: { verifier: "http_status", ok: false } },
    "failed",
  );
  assert.deepEqual([ev.state, ev.verification], ["failed", "failed"]);
});

test("resultado indeterminado → unknown", () => {
  const ev = evidenceFor("send_message", { output: "?" }, "unknown");
  assert.deepEqual(
    [ev.state, ev.verification, ev.verifiedBy],
    ["unknown", "unknown", "contract_text"],
  );
});

// ---------- classifyOutcome: regressão dos contratos textuais ----------
test("classifyOutcome preserva os contratos documentados", () => {
  assert.equal(classifyOutcome("send_message", "Enviado no Telegram."), "confirmed");
  assert.equal(classifyOutcome("send_message", "Telegram 400: Bad Request"), "failed");
  assert.equal(classifyOutcome("send_message", "Canal signal desabilitado."), "denied");
  assert.equal(
    classifyOutcome(
      "openhands_task",
      "Tarefa enviada ao OpenHands (conversation_id: abc, status: running).",
    ),
    "confirmed",
  );
  assert.equal(classifyOutcome("rea_analyze", "Evidence: ev_x"), "confirmed");
  assert.equal(
    classifyOutcome("rea_analyze", "REA terminou com exit 1 sem Evidence válida"),
    "failed",
  );
});

// ---------- sendMessage: pós-condição real do provedor ----------
const setTelegram = () =>
  updateSettings(
    { comms: { telegram: { enabled: true, botToken: "tok-teste", chatId: "42" } } },
    { adminId: A.adminId, allowGlobal: false },
  );
const setWhatsapp = () =>
  updateSettings(
    {
      comms: {
        whatsapp: { enabled: true, token: "tok-wa", phoneNumberId: "p1", to: "5511999999999" },
      },
    },
    { adminId: A.adminId, allowGlobal: false },
  );

test("telegram: 2xx com message_id → verificador comprovado", async () => {
  setTelegram();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true, result: { message_id: 777 } }),
  });
  const r = await sendMessage(A.adminId, "telegram", "olá", undefined);
  assert.equal(r.output, "Enviado no Telegram.");
  assert.deepEqual(r.verify, { verifier: "provider_message_id", ok: true });
});

test("telegram: 2xx SEM identificador (corpo vazio/malformado) → não comprovado", async () => {
  setTelegram();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => "<html>200 OK</html>",
  });
  const r = await sendMessage(A.adminId, "telegram", "olá", undefined);
  assert.deepEqual(
    r.verify,
    { verifier: "http_status", ok: false },
    "2xx isolado não prova aceitação",
  );
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true }),
  });
  const r2 = await sendMessage(A.adminId, "telegram", "olá", undefined);
  assert.deepEqual(r2.verify, { verifier: "http_status", ok: false });
});

test("telegram: erro HTTP → sem verificador e mensagem de falha", async () => {
  setTelegram();
  globalThis.fetch = async () => ({ ok: false, status: 400, text: async () => "Bad Request" });
  const r = await sendMessage(A.adminId, "telegram", "olá", undefined);
  assert.equal(r.verify, undefined);
  assert.match(r.output, /Telegram 400/);
});

test("whatsapp: 2xx com messages[0].id → comprovado; sem id → não comprovado", async () => {
  setWhatsapp();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ messages: [{ id: "wamid.1" }] }),
  });
  const ok = await sendMessage(A.adminId, "whatsapp", "olá", undefined);
  assert.deepEqual(ok.verify, { verifier: "provider_message_id", ok: true });
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({}) });
  const no = await sendMessage(A.adminId, "whatsapp", "olá", undefined);
  assert.deepEqual(no.verify, { verifier: "http_status", ok: false });
});

test("sendMessage nunca vaza token/segredo no output", async () => {
  setTelegram();
  globalThis.fetch = async () => ({ ok: false, status: 401, text: async () => "unauthorized" });
  const r = await sendMessage(A.adminId, "telegram", "olá", undefined);
  assert.ok(!String(r.output).includes("tok-teste"), "token fora do output");
  assert.ok(!JSON.stringify(r).includes("tok-wa"));
});

// ---------- integração: resolveApproval grava a semântica nova ----------
test("integração: exit!=0 grava state=failed E verification=failed", async () => {
  await setHost("false");
  const c = ctx();
  const out = await callTool("run_command", { command: "false" }, c);
  assert.ok(c.pending.length, `esperava aprovação de run_command; saída=${String(out)}`);
  const id = c.pending[0].id;
  await resolveApproval(id, true, A.principal);
  const e = listEvidence(id)[0];
  assert.equal(e.state, "failed");
  assert.equal(e.exitCode, 1);
  assert.equal(e.verification, "failed", "exit 1 é evidência de falha da operação");
  assert.equal(e.verifiedBy, "exit_code");
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "error");
});

test("integração: envio comprovado pelo provedor grava verification=verified", async () => {
  setTelegram();
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true, result: { message_id: 9001 } }),
  });
  const c = ctx();
  await callTool("send_message", { channel: "telegram", text: "ping de verificação" }, c);
  const id = c.pending[0].id;
  assert.ok(id, "aprovação criada (nada executado antes disso)");
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "pending");
  await resolveApproval(id, true, A.principal);
  const e = listEvidence(id)[0];
  assert.equal(e.state, "completed");
  assert.equal(e.verification, "verified");
  assert.equal(e.verifiedBy, "provider_message_id");
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "done");
});

test("integração: 2xx SEM identificador fica unverified — nunca verified", async () => {
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ ok: true }),
  });
  const c = ctx();
  await callTool("send_message", { channel: "telegram", text: "sem id" }, c);
  const id = c.pending[0].id;
  await resolveApproval(id, true, A.principal);
  const e = listEvidence(id)[0];
  assert.equal(e.verification, "unverified");
  assert.equal(e.verifiedBy, "http_status");
});

test("integração: falha HTTP grava verification=failed e status error", async () => {
  globalThis.fetch = async () => ({ ok: false, status: 403, text: async () => "forbidden" });
  const c = ctx();
  await callTool("send_message", { channel: "telegram", text: "vai falhar" }, c);
  const id = c.pending[0].id;
  await resolveApproval(id, true, A.principal);
  const e = listEvidence(id)[0];
  assert.equal(e.state, "failed");
  assert.equal(e.verification, "failed");
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "error");
});

test("ledger: nenhuma linha viola os conjuntos fechados", () => {
  const rows = db.prepare("SELECT verification, verified_by, state FROM execution_evidence").all();
  for (const r of rows) {
    assert.ok(
      EVIDENCE_VERIFICATIONS.has(r.verification),
      `verification inválido: ${r.verification}`,
    );
    assert.ok(EVIDENCE_STATES.has(r.state), `state inválido: ${r.state}`);
    assert.match(
      String(r.verified_by),
      /^[a-zA-Z0-9_.:@-]{1,80}$/,
      `verifiedBy inválido: ${r.verified_by}`,
    );
  }
});

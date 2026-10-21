// P1.1 — semântica dos resultados: classifyOutcome + correlação nos eventos corrigidos.
// Banco TEMPORÁRIO: nunca toca o banco ativo. Stubs locais: nenhum efeito externo.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-outcomes-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { auth, db } = await import("../server/db.js");
const { createApp } = await import("../server/index.js");
const { classifyOutcome, callTool, resolveApproval } = await import("../server/tools.js");
const { sendEmail } = await import("../server/comms.js");
const { createServer } = await import("node:http");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const CORR = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

let server, base;
const A = {};
const req = (path, { method = "GET", body, s } = {}) =>
  fetch(base + path, {
    method,
    headers: { origin: ORIGIN, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(s ? { cookie: s.cookie, "x-jarvis-csrf": s.csrf } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const login = async () => {
  const r = await req("/api/auth/login", { method: "POST", body: { username: "ana", password: PW } });
  const j = await r.json();
  Object.assign(A, { cookie: r.headers.get("set-cookie").split(";")[0], csrf: j.csrf, id: j.admin.id });
  A.principal = auth.validateSession(A.cookie.split("=")[1]);
};
const auditRows = () => db.prepare("SELECT kind, detail FROM audit ORDER BY id").all();

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  await login();
});
after(() => server.close());

// ---------- classifyOutcome: contratos reais ----------
test("run_command (runShell): saída com [erro] é falha confirmada, não sucesso", () => {
  assert.equal(classifyOutcome("run_command", "linha1\nlinha2"), "confirmed");
  assert.equal(classifyOutcome("run_command", "ok\n[erro] exit 1"), "failed");
  assert.equal(classifyOutcome("run_command", "[erro] tempo limite excedido (60000 ms)"), "failed");
  assert.equal(classifyOutcome("cli_agent", "[erro] exit 2"), "failed");
});

test("send_message: 'Enviado no ...' é sucesso; strings de erro são falha; cancelamento é denied", () => {
  assert.equal(classifyOutcome("send_message", "Enviado no Telegram."), "confirmed");
  assert.equal(classifyOutcome("send_message", "Telegram 400: Bad Request"), "failed");
  assert.equal(classifyOutcome("send_message", "Canal signal desabilitado."), "denied");
  assert.equal(classifyOutcome("send_message", "Envio cancelado: o canal/destinatário mudou desde a aprovação."), "denied");
  assert.equal(classifyOutcome("send_message", "resposta inesperada sem marcador"), "unknown");
});

test("openhands_task: confirmação por texto do contrato", () => {
  assert.equal(classifyOutcome("openhands_task", "Tarefa enviada ao OpenHands (conversation_id: conv-1, status: running)."), "confirmed");
  assert.equal(classifyOutcome("openhands_task", "Delegação cancelada: a integração mudou desde a aprovação."), "denied");
  assert.equal(classifyOutcome("openhands_task", "OpenHands 500: Internal Server Error"), "failed");
  assert.equal(classifyOutcome("openhands_task", "resposta genérica"), "unknown");
});

test("rea_analyze: Evidence no resumo = sucesso; cancelada/exit/falha = falha; resto = unknown", () => {
  assert.equal(classifyOutcome("rea_analyze", "Evidence: abc123\nAlvo: …"), "confirmed");
  assert.equal(classifyOutcome("rea_analyze", "Análise cancelada: a integração, o caminho ou o alvo mudaram desde a aprovação."), "denied");
  assert.equal(classifyOutcome("rea_analyze", "REA terminou com exit 1 sem Evidence válida; detalhes em data/rea/ (x.log)."), "failed");
  assert.equal(classifyOutcome("rea_analyze", "A análise não concluiu dentro do tempo limite; a saída parcial está gravada em data/rea/."), "failed");
  assert.equal(classifyOutcome("rea_analyze", "resultado vago"), "unknown");
});

// ---------- rea_analyze(refused): correlação presente ----------
test("rea_analyze(refused) inclui correlação do contexto", async () => {
  await req("/api/settings", { method: "PUT", body: { integrations: { rea: { enabled: true } } }, s: A });
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  const out = await callTool("rea_analyze", { path: "/etc/passwd" }, c);
  assert.match(out, /fora das raízes|não é permitido|absoluto/i);
  const ev = auditRows().filter((r) => r.kind === "rea_analyze(refused)");
  assert.equal(ev.length, 1);
  assert.equal(JSON.parse(ev[0].detail).correlation, CORR);
});

// ---------- send_email(draft_created): correlação presente ----------
test("send_email(draft_created) inclui correlação do contexto", async () => {
  await req("/api/settings", { method: "PUT", body: { host: { enabled: true } }, s: A });
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  const out = await callTool("send_email", { account: "gmail", to: "x@y.z", subject: "s", body: "b" }, c);
  assert.match(out, /rascunho|revisao/i);
  const ev = auditRows().filter((r) => r.kind === "send_email(draft_created)");
  assert.equal(ev.length, 1);
  assert.equal(JSON.parse(ev[0].detail).correlation, CORR);
});

// ---------- resolução via aprovação: sucesso confirmado não regride ----------
test("approve → started → done com sucesso confirmado (contrato real)", async () => {
  await req("/api/settings", { method: "PUT", body: { host: { enabled: true, allowlist: "echo" } }, s: A });
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  await callTool("run_command", { command: "echo ok" }, c);
  const id = c.pending[0].id;
  const res = await resolveApproval(id, true, A.principal);
  assert.equal(res.output, "ok");
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "done");
  const ks = auditRows().filter((r) => r.detail.includes(id)).map((r) => r.kind);
  assert.ok(ks.includes("run_command(started)"));
  assert.ok(ks.includes("run_command(done)"));
  const done = auditRows().find((r) => r.kind === "run_command(done)" && r.detail.includes(id));
  assert.equal(JSON.parse(done.detail).correlation, CORR);
});

// ---------- falha confirmada por contrato: não é mais done ----------
test("falha confirmada (ex.: shell não-zero) gera error, nunca done", async () => {
  await req("/api/settings", { method: "PUT", body: { host: { enabled: true, allowlist: "false" } }, s: A });
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  await callTool("run_command", { command: "false" }, c);
  const id = c.pending[0].id;
  const res = await resolveApproval(id, true, A.principal);
  assert.match(res.output, /Falha ao executar/);
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "error");
  const ks = auditRows().filter((r) => r.detail.includes(id)).map((r) => r.kind);
  assert.ok(!ks.includes("run_command(done)"), "done indevido");
  assert.ok(ks.includes("run_command(error)"), "error ausente");
});

// ---------- unknown: timeout/abort → sem reexecução ----------
test("timeout de rede: unknown + interrupted, sem reexecução", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url;
    if (url && url.includes("/api/conversations")) throw Object.assign(new Error("This operation was aborted"), { name: "TimeoutError" });
    return realFetch(input, init);
  };
  const cfg = { host: { enabled: true }, integrations: { openhands: { enabled: true, command: "http://127.0.0.1:9" } } };
  await req("/api/settings", { method: "PUT", body: cfg, s: A });
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  await callTool("openhands_task", { task: "t" }, c);
  const id = c.pending[0].id;
  const res = await resolveApproval(id, true, A.principal);
  assert.match(res.output, /resultado incerto/i);
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "interrupted");
  const ks = auditRows().filter((r) => r.detail.includes(id)).map((r) => r.kind);
  assert.ok(ks.includes("openhands_task(unknown)"));
  assert.ok(!ks.includes("openhands_task(done)"));
  await assert.rejects(() => resolveApproval(id, true, A.principal), /already_resolved/);
  globalThis.fetch = realFetch;
});

// ---------- openhands 200 sem conversation_id: contrato ainda confirma (limitação documentada) ----------
test("openhands 200 sem conversation_id → confirmed (contrato atual)", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url;
    if (url && url.includes("/api/conversations")) return new Response(JSON.stringify({}), { status: 200 });
    return realFetch(input, init);
  };
  const cfg = { host: { enabled: true }, integrations: { openhands: { enabled: true, command: "http://127.0.0.1:9" } } };
  await req("/api/settings", { method: "PUT", body: cfg, s: A });
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  await callTool("openhands_task", { task: "t" }, c);
  const id = c.pending[0].id;
  const res = await resolveApproval(id, true, A.principal);
  assert.match(res.output, /Tarefa enviada ao OpenHands/);
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "done");
  globalThis.fetch = realFetch;
});

// ---------- send_message: sucesso confirmado por contrato (stub local) ----------
test("send_message 'Enviado no Telegram.' → done; erro HTTP → error (sem efeito externo)", async () => {
  // Canal fake habilitado: sendMessage chama fetch ao Telegram; stub responde 200/400.
  await req("/api/settings", { method: "PUT", body: { comms: { telegram: { enabled: true, botToken: "t", chatId: "1" } } }, s: A });
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url;
    if (url && url.includes("api.telegram.org")) return new Response("{\"ok\":true}", { status: 200 });
    return realFetch(input, init);
  };
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  await callTool("send_message", { channel: "telegram", text: "oi" }, c);
  const id = c.pending[0].id;
  let res = await resolveApproval(id, true, A.principal);
  assert.match(res.output, /Enviado no Telegram/);
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "done");
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url;
    if (url && url.includes("api.telegram.org")) return new Response("{\"ok\":false}", { status: 400 });
    return realFetch(input, init);
  };
  await callTool("send_message", { channel: "telegram", text: "oi2" }, c);
  const id2 = c.pending[1].id;
  res = await resolveApproval(id2, true, A.principal);
  assert.match(res.output, /Falha ao executar/);
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id2).status, "error");
  const ks = auditRows().filter((r) => r.detail.includes(id2)).map((r) => r.kind);
  assert.ok(!ks.includes("send_message(done)"));
  assert.ok(ks.includes("send_message(error)"));
  globalThis.fetch = realFetch;
});
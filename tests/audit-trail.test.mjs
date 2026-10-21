// Fase II P1 — trilha de execução + correlação persistente (sem migração de schema).
// Banco TEMPORÁRIO (JARVIS_DATA_DIR): nunca toca o banco ativo. Correlação é UUID v4 gravado
// dentro de approval_actions.action (JSON) e reaparece em todos os eventos da cadeia.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";

const dir = mkdtempSync(join(tmpdir(), "jarvis-trail-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { auth, db, audit } = await import("../server/db.js");
const { createApp } = await import("../server/index.js");
const { callTool, resolveApproval } = await import("../server/tools.js");
const { createHash } = await import("node:crypto");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const SECRET = "TOKEN_SECRETO_TRILHA_999";
const CORR = "11111111-2222-4333-8444-555555555555";

let server, base;
const A = {};
const req = (path, { method = "GET", body, s } = {}) =>
  fetch(base + path, {
    method,
    headers: { origin: ORIGIN, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(s ? { cookie: s.cookie, "x-jarvis-csrf": s.csrf } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const login = async (t) => {
  const r = await req("/api/auth/login", { method: "POST", body: { username: "ana", password: PW } });
  const j = await r.json();
  Object.assign(t, { cookie: r.headers.get("set-cookie").split(";")[0], csrf: j.csrf, id: j.admin.id });
  t.principal = auth.validateSession(t.cookie.split("=")[1]);
};
const auditRows = () => db.prepare("SELECT id, kind, detail FROM audit ORDER BY id").all();
const kinds = (rows) => rows.map((r) => r.kind);
const hostOn = (on) => req("/api/settings", { method: "PUT", body: { host: { enabled: on, allowlist: "echo" } }, s: A });

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  await login(A);
});
after(() => server.close());

test("cadeia proposta→decisão→início→resultado com correlação ponta a ponta", async () => {
  await hostOn(true);
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  const out = await callTool("run_command", { command: `echo trilha` }, c);
  assert.match(out, /aprovação/);
  const id = c.pending[0].id;
  const r = await req(`/api/approvals/${id}`, { method: "POST", body: { approve: true }, s: A });
  assert.equal(r.status, 200);
  const chain = auditRows().filter((r) => r.detail.includes(id));
  const chainKinds = chain.map((r) => r.kind);
  for (const k of ["run_command(requested)", "run_command(approved)", "run_command(started)", "run_command(done)"]) {
    assert.ok(chainKinds.includes(k), `evento ${k} ausente`);
  }
  // ordem estrita por id (append-only)
  const idx = (k) => chain.find((r) => r.kind === k).id;
  assert.ok(idx("run_command(requested)") < idx("run_command(approved)"));
  assert.ok(idx("run_command(approved)") < idx("run_command(started)"));
  assert.ok(idx("run_command(started)") < idx("run_command(done)"));
  // correlação igual em todos os eventos
  for (const r of chain) {
    const d = JSON.parse(r.detail);
    assert.equal(d.correlation, CORR, `correlação ausente em ${r.kind}`);
    assert.equal(d.approvalId, id);
  }
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "done");
  await hostOn(false);
});

test("sanitização: segredo no comando nunca chega à trilha, correlação permanece válida", async () => {
  await hostOn(true);
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  await callTool("run_command", { command: `echo ${SECRET}` }, c);
  const full = { autonomy: "full", pending: [], principal: A.principal, correlation: CORR };
  const out = await callTool("run_command", { command: `echo ${SECRET}` }, full);
  assert.equal(out, SECRET, "comando executou (saída = segredo)");
  assert.equal(auditRows().map((r) => `${r.kind} ${r.detail}`).join("\n").includes(SECRET), false, "segredo na auditoria");
  // correlation de cada evento é UUID válido
  for (const r of auditRows()) {
    const d = JSON.parse(r.detail);
    if (d.correlation) assert.ok(UUID_RE.test(d.correlation), `correlação inválida em ${r.kind}`);
  }
  await hostOn(false);
});

test("concorrência: resolução paralela gera uma única cadeia started/done", async () => {
  await hostOn(true);
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  await callTool("run_command", { command: "echo corrida" }, c);
  const id = c.pending[0].id;
  const beforeStarted = auditRows().filter((r) => r.detail.includes(id) && r.kind === "run_command(started)").length;
  const beforeDone = auditRows().filter((r) => r.detail.includes(id) && r.kind === "run_command(done)").length;
  const rs = await Promise.all([1, 2, 3].map(() => resolveApproval(id, true, A.principal).then((x) => ({ ok: true, x })).catch((e) => ({ ok: false, e }))));
  assert.equal(rs.filter((r) => r.ok).length, 1, "exatamente um resolve deve ter sucesso");
  assert.equal(rs.filter((r) => !r.ok).length, 2, "os outros devem falhar");
  const afterStarted = auditRows().filter((r) => r.detail.includes(id) && r.kind === "run_command(started)").length;
  const afterDone = auditRows().filter((r) => r.detail.includes(id) && r.kind === "run_command(done)").length;
  assert.equal(afterStarted - beforeStarted, 1, "started deve ocorrer exatamente uma vez");
  assert.equal(afterDone - beforeDone, 1, "done deve ocorrer exatamente uma vez");
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "done");
  await hostOn(false);
});

test("recusa humana: evento denied com correlação, sem started/done", async () => {
  await hostOn(true);
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  await callTool("run_command", { command: "echo negado" }, c);
  const id = c.pending[0].id;
  const before = auditRows().filter((r) => r.detail.includes(id)).map((r) => r.kind);
  const res = await resolveApproval(id, false, A.principal);
  assert.equal(res.output, "Negado pelo usuário.");
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "denied");
  const after = auditRows().filter((r) => r.detail.includes(id)).map((r) => r.kind);
  assert.ok(after.includes("run_command(denied)"), "evento denied ausente");
  assert.ok(!after.includes("run_command(started)"), "started indevido");
  assert.ok(!after.includes("run_command(done)"), "done indevido");
  const denied = auditRows().find((r) => r.detail.includes(id) && r.kind === "run_command(denied)");
  assert.equal(JSON.parse(denied.detail).correlation, CORR);
  await hostOn(false);
});

test("gate mudou: host desativado consome como denied com reason, sem execução", async () => {
  await hostOn(true);
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  await callTool("run_command", { command: "echo depois" }, c);
  const id = c.pending[0].id;
  await hostOn(false);
  const res = await resolveApproval(id, true, A.principal);
  assert.match(res.output, /desabilitadas/);
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "denied");
  const row = auditRows().find((r) => r.detail.includes(id) && r.kind === "run_command(denied)");
  assert.equal(JSON.parse(row.detail).reason, "host_disabled");
  assert.equal(JSON.parse(row.detail).correlation, CORR);
  const kindsFor = auditRows().filter((r) => r.detail.includes(id)).map((r) => r.kind);
  assert.ok(!kindsFor.includes("run_command(started)"));
  assert.ok(!kindsFor.includes("run_command(done)"));
  await hostOn(true);
});

test("resultado desconhecido (timeout): unknown, sem done, sem reexecução", async () => {
  // openhands apontando para porta sem listener → fetch rejeita; classificado como unknown.
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url;
    if (url && url.includes("/api/conversations")) throw Object.assign(new Error("aborted by timeout"), { name: "TimeoutError" });
    return realFetch(input, init);
  };
  const cfg = { host: { enabled: true }, integrations: { openhands: { enabled: true, command: "http://127.0.0.1:9" } } };
  await req("/api/settings", { method: "PUT", body: cfg, s: A });
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  const out = await callTool("openhands_task", { task: "tarefa incerta" }, c);
  assert.match(out, /aprovação/);
  const id = c.pending[0].id;
  const res = await resolveApproval(id, true, A.principal);
  assert.match(res.output, /resultado incerto/i);
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "interrupted");
  const ks = auditRows().filter((r) => r.detail.includes(id)).map((r) => r.kind);
  assert.ok(ks.includes("openhands_task(unknown)"), "evento unknown ausente");
  assert.ok(!ks.includes("openhands_task(done)"), "done indevido");
  assert.ok(!ks.includes("openhands_task(error)"), "error indevido");
  // segunda resolução: não reexecuta
  await assert.rejects(() => resolveApproval(id, true, A.principal), /already_resolved/);
  globalThis.fetch = realFetch;
  await hostOn(false);
});

test("cancelamento de execução não cria eventos de aprovação espúrios", async () => {
  await hostOn(true);
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  await callTool("run_command", { command: "echo cancelar" }, c);
  const id = c.pending[0].id;
  // sem resolve: nenhum started/done — aprovação permanece pending (cancelada pelo humano)
  const ks = auditRows().filter((r) => r.detail.includes(id)).map((r) => r.kind);
  assert.ok(!ks.includes("run_command(started)"));
  assert.ok(!ks.includes("run_command(done)"));
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "pending");
  await hostOn(false);
});
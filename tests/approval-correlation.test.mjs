// Fase II P2.1 — integração da coluna correlation_id (v9) + fallback JSON legado.
// Banco TEMPORÁRIO (JARVIS_DATA_DIR): nunca toca o banco ativo. Bancos avulsos em disco temporário
// para testar as duas capacidades de esquema (v8 sem coluna / v9 com coluna). Sem efeitos externos.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";

const dir = mkdtempSync(join(tmpdir(), "jarvis-corr-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const {
  auth,
  db,
  detectApprovalCorrelation,
  resolveCorrelation,
  approvalCorrelation,
  insertApprovalAction,
} = await import("../server/db.js");
const { createApp } = await import("../server/index.js");
const { callTool, resolveApproval } = await import("../server/tools.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const CORR = "11111111-2222-4333-8444-555555555555";
const CORR_B = "22222222-3333-4444-8555-666666666666";

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
const hostOn = (on) =>
  req("/api/settings", { method: "PUT", body: { host: { enabled: on, allowlist: "echo" } }, s: A });

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  const r = await req("/api/auth/login", {
    method: "POST",
    body: { username: "ana", password: PW },
  });
  const j = await r.json();
  Object.assign(A, {
    cookie: r.headers.get("set-cookie").split(";")[0],
    csrf: j.csrf,
    id: j.admin.id,
  });
  A.principal = auth.validateSession(A.cookie.split("=")[1]);
});
after(() => server.close());

// Banco avulso descartável, com ou sem a coluna estruturada (v8 vs v9).
const mkdb = (withColumn) => {
  const d = new DatabaseSync(join(mkdtempSync(join(tmpdir(), "jarvis-corr-db-")), "x.db"));
  d.exec(
    withColumn
      ? "CREATE TABLE approval_actions (approval_id TEXT PRIMARY KEY, action TEXT NOT NULL, correlation_id TEXT, created_at TEXT NOT NULL);"
      : "CREATE TABLE approval_actions (approval_id TEXT PRIMARY KEY, action TEXT NOT NULL, created_at TEXT NOT NULL);",
  );
  return d;
};
const hasCol = (d) =>
  d
    .prepare("PRAGMA table_info(approval_actions)")
    .all()
    .some((c) => c.name === "correlation_id");

test("detecção explícita de capacidade: v9 tem a coluna, v8 não", () => {
  const v9 = mkdb(true),
    v8 = mkdb(false);
  assert.equal(detectApprovalCorrelation(v9), true);
  assert.equal(detectApprovalCorrelation(v8), false);
  v9.close();
  v8.close();
});

test("resolveCorrelation: coluna autoritativa, JSON fallback, divergência sinalizada", () => {
  assert.deepEqual(resolveCorrelation(CORR, CORR), { value: CORR, mismatch: false });
  assert.deepEqual(resolveCorrelation(null, CORR), { value: CORR, mismatch: false });
  assert.deepEqual(resolveCorrelation(CORR, null), { value: CORR, mismatch: false });
  assert.deepEqual(resolveCorrelation(CORR, CORR_B), { value: CORR, mismatch: true });
  assert.deepEqual(resolveCorrelation("nao-uuid", CORR), { value: CORR, mismatch: true });
  assert.deepEqual(resolveCorrelation(null, null), { value: null, mismatch: false });
});

test("insertApprovalAction: v9 grava a coluna e preserva o JSON; v8 grava sem a coluna", () => {
  const v9 = mkdb(true);
  insertApprovalAction("ap1", { kind: "run_command", correlation: CORR }, CORR, {
    database: v9,
    hasColumn: true,
  });
  const r9 = v9
    .prepare("SELECT action, correlation_id FROM approval_actions WHERE approval_id='ap1'")
    .get();
  assert.equal(r9.correlation_id, CORR, "coluna gravada na v9");
  assert.equal(JSON.parse(r9.action).correlation, CORR, "JSON preservado na transição");
  const v8 = mkdb(false);
  insertApprovalAction("ap2", { kind: "run_command", correlation: CORR }, CORR, {
    database: v8,
    hasColumn: false,
  });
  const r8 = v8.prepare("SELECT action FROM approval_actions WHERE approval_id='ap2'").get();
  assert.equal(JSON.parse(r8.action).correlation, CORR);
  assert.equal(hasCol(v8), false, "v8 permanece sem a coluna");
  v9.close();
  v8.close();
});

test("insertApprovalAction: correlação inválida nunca é gravada na coluna", () => {
  const v9 = mkdb(true);
  insertApprovalAction("ap3", { kind: "run_command" }, "nao-uuid", {
    database: v9,
    hasColumn: true,
  });
  assert.equal(
    v9.prepare("SELECT correlation_id FROM approval_actions WHERE approval_id='ap3'").get()
      .correlation_id,
    null,
  );
  v9.close();
});

test("approvalCorrelation: prefere a coluna, fallback JSON legado, divergência gera diagnóstico", () => {
  const d = mkdb(true);
  const ins = d.prepare(
    "INSERT INTO approval_actions (approval_id, action, correlation_id, created_at) VALUES (?,?,?,?)",
  );
  ins.run("same", JSON.stringify({ correlation: CORR }), CORR, "t");
  ins.run("legacy", JSON.stringify({ correlation: CORR }), null, "t"); // coluna NULL, JSON preenchido
  ins.run("div", JSON.stringify({ correlation: CORR_B }), CORR, "t"); // divergência
  assert.equal(approvalCorrelation("same", { correlation: CORR }, { database: d }), CORR);
  assert.equal(
    approvalCorrelation("legacy", { correlation: CORR }, { database: d }),
    CORR,
    "fallback JSON",
  );
  assert.equal(
    approvalCorrelation("div", { correlation: CORR_B }, { database: d }),
    CORR,
    "coluna vence",
  );
  const diag = db
    .prepare(
      "SELECT detail FROM audit WHERE kind='audit.correlation_mismatch' ORDER BY id DESC LIMIT 1",
    )
    .get();
  assert.ok(diag, "diagnóstico de divergência registrado");
  assert.equal(JSON.parse(diag.detail).reason, "correlation_mismatch");
  d.close();
});

test("approvalCorrelation: esquema v8 (sem coluna) usa o JSON", () => {
  const d = mkdb(false);
  d.prepare("INSERT INTO approval_actions (approval_id, action, created_at) VALUES (?,?,?)").run(
    "ap",
    JSON.stringify({ correlation: CORR }),
    "t",
  );
  assert.equal(
    approvalCorrelation("ap", { correlation: CORR }, { database: d, hasColumn: false }),
    CORR,
  );
  d.close();
});

test("integração v9: queueApproval grava coluna + JSON; a cadeia carrega a correlação", async () => {
  await hostOn(true);
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  const out = await callTool("run_command", { command: "echo corr" }, c);
  assert.match(out, /aprovação/);
  const id = c.pending[0].id;
  const row = db
    .prepare("SELECT action, correlation_id FROM approval_actions WHERE approval_id=?")
    .get(id);
  assert.equal(row.correlation_id, CORR, "coluna preenchida na integração real");
  assert.equal(JSON.parse(row.action).correlation, CORR, "JSON preservado");
  const res = await resolveApproval(id, true, A.principal);
  assert.equal(res.output.trim(), "corr");
  const chain = db
    .prepare("SELECT kind, detail FROM audit WHERE detail LIKE ? ORDER BY id")
    .all(`%${id}%`);
  for (const k of [
    "run_command(requested)",
    "run_command(approved)",
    "run_command(started)",
    "run_command(done)",
  ]) {
    const ev = chain.find((r) => r.kind === k);
    assert.ok(ev, `evento ${k} ausente`);
    assert.equal(JSON.parse(ev.detail).correlation, CORR, `correlação ausente em ${k}`);
  }
  await hostOn(false);
});

test("ctx.correlation inválido é descartado (não vira coluna nem JSON)", async () => {
  await hostOn(true);
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: "nao-e-uuid" };
  await callTool("run_command", { command: "echo x" }, c);
  const id = c.pending[0].id;
  const row = db
    .prepare("SELECT action, correlation_id FROM approval_actions WHERE approval_id=?")
    .get(id);
  assert.equal(row.correlation_id, null);
  assert.equal(JSON.parse(row.action).correlation, undefined);
  await hostOn(false);
});

test("regressão: negação mantém a correlação e a semântica de status", async () => {
  await hostOn(true);
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  await callTool("run_command", { command: "echo negar" }, c);
  const id = c.pending[0].id;
  const r = await resolveApproval(id, false, A.principal);
  assert.equal(r.output, "Negado pelo usuário.");
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "denied");
  const denied = db
    .prepare("SELECT detail FROM audit WHERE kind='run_command(denied)' AND detail LIKE ?")
    .get(`%${id}%`);
  assert.equal(JSON.parse(denied.detail).correlation, CORR);
  await hostOn(false);
});

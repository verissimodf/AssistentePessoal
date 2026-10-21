// P0 — Execução verificável: contrato estruturado de `runShell`, ledger de evidência por execução,
// correlação com a auditoria/aprovações, isolamento e privacidade. Banco TEMPORÁRIO; sem efeitos externos.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createServer } from "node:http";

const dir = mkdtempSync(join(tmpdir(), "jarvis-evid-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { auth, db, listEvidence } = await import("../server/db.js");
const { createApp } = await import("../server/index.js");
const { runShell, classifyOutcome, callTool, resolveApproval, resultText } =
  await import("../server/tools.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const CORR = "11111111-2222-4333-8444-555555555555";
const SECRET = "TOKEN_EVIDENCIA_SECRETO_77";

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
const hostOn = (on, allowlist = "echo,false,true") =>
  req("/api/settings", { method: "PUT", body: { host: { enabled: on, allowlist } }, s: A });
const evidenceRows = () => db.prepare("SELECT * FROM execution_evidence ORDER BY rowid").all();

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

// ---------- Etapa A: contrato estruturado de runShell ----------
test("runShell: código de saída zero → completed/exitCode 0; não zero → failed/exitCode N", async () => {
  const ok = await runShell("echo evid-ok", 5000);
  assert.deepEqual([ok.state, ok.exitCode, ok.timedOut], ["completed", 0, false]);
  assert.match(ok.output, /evid-ok/);
  const bad = await runShell("exit 7", 5000);
  assert.equal(bad.state, "failed");
  assert.equal(bad.exitCode, 7);
});

test("runShell: timeout → state timeout, exitCode null, timedOut true (sem reexecução)", async (t) => {
  if (process.platform === "win32") return t.skip("comando Unix de longa duração");
  const r = await runShell("sh -c 'sleep 30'", 400);
  assert.equal(r.state, "timeout");
  assert.equal(r.timedOut, true);
  assert.equal(r.exitCode, null);
});

test("runShell: comando inexistente → failed (exit ≠ 0); saída excessiva → overflow (kill)", async (t) => {
  const nf = await runShell("comando-que-nao-existe-xyz", 5000);
  assert.equal(nf.state, "failed");
  assert.notEqual(nf.exitCode, 0);
  if (process.platform === "win32") return t.skip("overflow usa utilitários Unix");
  const big = await runShell("yes x | head -c 3000000", 20000); // > MAX_SHELL_OUTPUT (2MB)
  assert.equal(big.state, "overflow");
  assert.equal(big.overflow, true);
});

test("classifyOutcome: prefere evidência estruturada; cai no contrato textual para strings", () => {
  assert.equal(classifyOutcome("run_command", { state: "completed", exitCode: 0 }), "confirmed");
  assert.equal(classifyOutcome("run_command", { state: "failed", exitCode: 2 }), "failed");
  assert.equal(classifyOutcome("run_command", { state: "error", exitCode: null }), "failed");
  assert.equal(classifyOutcome("run_command", { state: "timeout", exitCode: null }), "unknown");
  assert.equal(classifyOutcome("run_command", { state: "overflow", exitCode: 0 }), "unknown");
  // legado (string): o contrato textual continua válido
  assert.equal(classifyOutcome("run_command", "tudo certo"), "confirmed");
  assert.equal(classifyOutcome("run_command", "linha\n[erro] exit 1"), "failed");
  assert.equal(resultText({ output: "abc" }), "abc");
  assert.equal(resultText("abc"), "abc");
});

test("consumidor direto (callTool run_command) devolve TEXTO (string) ao modelo", async () => {
  await hostOn(true, "echo");
  const c = { autonomy: "full", pending: [], principal: A.principal, correlation: CORR };
  const out = await callTool("run_command", { command: "echo consumidor" }, c);
  assert.equal(typeof out, "string");
  assert.match(out, /consumidor/);
});

// ---------- Etapas B/C: ledger de evidência + correlação ----------
test("sucesso: evidência gravada com state/exitCode/verification/correlação/audit_id", async () => {
  await hostOn(true, "echo");
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  await callTool("run_command", { command: "echo evidenciado" }, c);
  const id = c.pending[0].id;
  await resolveApproval(id, true, A.principal);
  const ev = listEvidence(id);
  assert.equal(ev.length, 1, "uma evidência por execução");
  const e = ev[0];
  assert.equal(e.kind, "run_command");
  assert.equal(e.state, "completed");
  assert.equal(e.exitCode, 0);
  assert.equal(e.verification, "unverified", "exit 0 é evidência técnica, não prova do objetivo");
  assert.equal(e.verifiedBy, "exit_code");
  assert.equal(e.correlation, CORR, "correlação preservada");
  assert.ok(Number.isInteger(e.auditId) && e.auditId > 0, "referência ao evento de auditoria");
  assert.ok(/^[0-9a-f]{64}$/.test(e.inputHash), "hash canônico da identidade da operação");
});

test("falha confirmada: state failed e approval error; done NÃO é usado", async () => {
  await hostOn(true, "false");
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  await callTool("run_command", { command: "false" }, c);
  const id = c.pending[0].id;
  await resolveApproval(id, true, A.principal);
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "error");
  const e = listEvidence(id)[0];
  assert.equal(e.state, "failed");
  assert.equal(e.exitCode, 1);
  const kinds = db
    .prepare("SELECT kind FROM audit WHERE detail LIKE ?")
    .all(`%${id}%`)
    .map((r) => r.kind);
  assert.ok(kinds.includes("run_command(error)"));
  assert.ok(!kinds.includes("run_command(done)"), "nunca 'done' sem evidência compatível");
});

test("resultado desconhecido (timeout de rede): state unknown, sem reexecução, evidência gravada", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input?.url;
    if (url && url.includes("/api/conversations"))
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    return realFetch(input, init);
  };
  await req("/api/settings", {
    method: "PUT",
    body: {
      host: { enabled: true },
      integrations: { openhands: { enabled: true, command: "http://127.0.0.1:9" } },
    },
    s: A,
  });
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  await callTool("openhands_task", { task: "t" }, c);
  const id = c.pending[0].id;
  await resolveApproval(id, true, A.principal);
  assert.equal(db.prepare("SELECT status FROM approvals WHERE id=?").get(id).status, "interrupted");
  const e = listEvidence(id)[0];
  assert.equal(e.state, "unknown");
  assert.equal(e.verifiedBy, "exception");
  await assert.rejects(() => resolveApproval(id, true, A.principal), /already_resolved/);
  globalThis.fetch = realFetch;
});

test("privacidade: segredo no comando NÃO aparece na evidência nem na auditoria", async () => {
  await hostOn(true, `echo ${SECRET}`);
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  await callTool("run_command", { command: `echo ${SECRET}` }, c);
  const id = c.pending[0].id;
  await resolveApproval(id, true, A.principal);
  const blob =
    JSON.stringify(evidenceRows()) + JSON.stringify(db.prepare("SELECT detail FROM audit").all());
  assert.equal(blob.includes(SECRET), false, "nenhum segredo na evidência/auditoria");
  assert.equal(JSON.stringify(evidenceRows()).includes("echo"), false, "nem o comando em claro");
});

// ---------- Etapa E: API de evidência + isolamento ----------
test("API /api/approvals/:id/evidence: dono vê; sem sessão → 401; estrangeiro → 404", async () => {
  await hostOn(true, "echo");
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  await callTool("run_command", { command: "echo api" }, c);
  const id = c.pending[0].id;
  await resolveApproval(id, true, A.principal);
  const ok = await req(`/api/approvals/${id}/evidence`, { s: A });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.evidence.length, 1);
  assert.equal(body.evidence[0].state, "completed");
  const noSess = await fetch(`${base}/api/approvals/${id}/evidence`, {
    headers: { origin: ORIGIN },
  });
  assert.equal(noSess.status, 401);
  const foreign = await req("/api/approvals/00000000-0000-4000-8000-000000000000/evidence", {
    s: A,
  });
  assert.equal(foreign.status, 404);
});

// ---------- Etapa C: migração v10 (esquema atual = 11, com a v11 `session_focus` do P0.2) ----------
test("migração v10: tabela execution_evidence + índices, integridade ok, sem tocar em v9", () => {
  const t = new DatabaseSync(join(dir, "jarvis.db"), { readOnly: true });
  assert.ok(
    t.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='execution_evidence'").get(),
    "tabela existe",
  );
  assert.ok(
    t.prepare("SELECT 1 FROM sqlite_master WHERE name='idx_execution_evidence_approval'").get(),
  );
  assert.ok(
    t.prepare("SELECT 1 FROM sqlite_master WHERE name='idx_execution_evidence_correlation'").get(),
  );
  assert.equal(t.prepare("PRAGMA user_version").get().user_version, 11);
  assert.equal(t.prepare("PRAGMA integrity_check").get().integrity_check, "ok");
  assert.ok(
    t.prepare("SELECT 1 FROM sqlite_master WHERE name='idx_approval_actions_correlation'").get(),
    "v9 intacta",
  );
  t.close();
});

test("persistência: a evidência sobrevive à releitura do banco (recuperação após reinício)", () => {
  const before = evidenceRows().length;
  const t = new DatabaseSync(join(dir, "jarvis.db"), { readOnly: true });
  assert.equal(t.prepare("SELECT COUNT(*) n FROM execution_evidence").get().n, before);
  t.close();
});

// ---------- P0.1: listagens do painel (owner-scoped) + pós-condição ----------
test("GET /api/approvals e /api/executions: dono vê; sem sessão 401; outro admin vê vazio", async () => {
  await hostOn(true, "echo");
  const c = { autonomy: "confirm", pending: [], principal: A.principal, correlation: CORR };
  await callTool("run_command", { command: "echo lista" }, c);
  const id = c.pending[0].id;
  await resolveApproval(id, true, A.principal);

  const ap = await (await req("/api/approvals", { s: A })).json();
  assert.ok(
    ap.approvals.some((a) => a.id === id),
    "aprovação listada para o dono",
  );
  assert.ok(
    ap.approvals.every((a) => !("output" in a)),
    "sem output/conteúdo privado",
  );

  const ex = await (await req("/api/executions", { s: A })).json();
  const row = ex.executions.find((e) => e.approvalId === id);
  assert.ok(row, "execução listada");
  assert.equal(row.state, "completed");
  assert.equal(row.exitCode, 0);
  assert.equal(row.verification, "unverified", "exit 0 não é prova do objetivo");
  assert.equal(row.verifiedBy, "exit_code");
  assert.equal(row.correlation, CORR);

  assert.equal((await fetch(`${base}/api/approvals`, { headers: { origin: ORIGIN } })).status, 401);
  assert.equal(
    (await fetch(`${base}/api/executions`, { headers: { origin: ORIGIN } })).status,
    401,
  );

  // Isolamento: segundo administrador não enxerga aprovações nem execuções do primeiro.
  auth.createAdmin(A.principal, {
    username: "bia",
    password: "senha-muito-forte-2",
    currentPassword: PW,
  });
  const lr = await req("/api/auth/login", {
    method: "POST",
    body: { username: "bia", password: "senha-muito-forte-2" },
  });
  const B = { cookie: lr.headers.get("set-cookie").split(";")[0], csrf: (await lr.json()).csrf };
  assert.equal(
    (await (await req("/api/approvals", { s: B })).json()).approvals.length,
    0,
    "outro admin não vê aprovações",
  );
  assert.equal(
    (await (await req("/api/executions", { s: B })).json()).executions.length,
    0,
    "outro admin não vê execuções",
  );
});

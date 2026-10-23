// B2 — LOOP COMPLETO DE AGENTES ponta a ponta: modelo (STUB sintético) → tool_call → aprovação
// humana (API/painel) → execução real da ferramenta → auditoria/evidência.
//
// Escopo e limites (deliberados):
//  - o provedor de modelo é substituído localmente (nenhuma rede, nenhuma inferência paga);
//  - a única ferramenta executada de verdade é `run_command`, com comandos EXPLICITAMENTE LIMITADOS
//    e reversíveis (`touch`/`ls`) dentro de um diretório temporário criado por este teste;
//  - nenhum e-mail é enviado, nenhum serviço externo é chamado, nada fora do temp dir é tocado;
//  - banco temporário (JARVIS_DATA_DIR), serviço implantado intocado.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-loop-e2e-"));
const work = mkdtempSync(join(tmpdir(), "jarvis-loop-work-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { createApp } = await import("../server/index.js");
const { auth, db } = await import("../server/db.js");
const { runAgent, cancelRun } = await import("../server/llm.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
const SECRET = "SEGREDO_LOOP_E2E_NAO_VAZAR";
let server, base;
const A = {},
  B = {};

// ---------- stub do provedor (mesmo padrão de tests/run-limits.test.mjs) ----------
const realFetch = globalThis.fetch;
let modelQueue = [];
const queueModel = (...responses) => {
  modelQueue = responses.slice();
};
const toolCall = (name, args) => ({
  choices: [
    {
      message: {
        content: "",
        tool_calls: [
          {
            id: `call-${modelQueue.length}`,
            type: "function",
            function: { name, arguments: JSON.stringify(args) },
          },
        ],
      },
    },
  ],
});
const finalAnswer = (text) => ({ choices: [{ message: { content: text } }] });
function stubProvider() {
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (!u.includes("/chat/completions")) return realFetch(url, init);
    const body = modelQueue.shift() ?? finalAnswer("(sem resposta do stub)");
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
}
const restoreProvider = () => {
  globalThis.fetch = realFetch;
  modelQueue = [];
};

// ---------- cliente HTTP ----------
const req = (path, { method = "GET", body, s } = {}) =>
  realFetch(base + path, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(s ? { cookie: s.cookie, "x-jarvis-csrf": s.csrf } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
const json = async (r) => ({ status: r.status, body: await r.json() });
const chat = (s, message) => req("/api/chat", { method: "POST", body: { message }, s });
const decide = (s, id, approve) =>
  req(`/api/approvals/${id}`, { method: "POST", body: { approve }, s });
const evidence = async (s, id) =>
  (await json(await req(`/api/approvals/${id}/evidence`, { s }))).body;
const approvals = async (s) => (await json(await req("/api/approvals", { s }))).body.approvals;
const auditRows = () => db.prepare("SELECT kind, detail FROM audit ORDER BY id").all();
const auditText = () => JSON.stringify(auditRows());
const byApproval = (id) => auditRows().filter((r) => String(r.detail).includes(id));
const setHost = (s, enabled, allowlist = "touch,ls") =>
  req("/api/settings", { method: "PUT", body: { host: { enabled, allowlist } }, s });
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

/** Dispara o loop (modelo emite 1 tool_call) e devolve { reply, approvalId }. */
async function askForCommand(s, command) {
  const before = new Set((await approvals(s)).map((a) => a.id));
  stubProvider();
  queueModel(toolCall("run_command", { command }), finalAnswer("Pedido enviado para aprovação."));
  const r = await json(await chat(s, `execute ${command}`));
  restoreProvider();
  assert.equal(r.status, 200, "o chat deve responder 200 com a aprovação pendente");
  const created = (await approvals(s)).filter((a) => !before.has(a.id));
  assert.equal(created.length, 1, "exatamente UMA aprovação nova criada pelo loop");
  assert.equal(created[0].status, "pending");
  return { reply: r.body, approvalId: created[0].id };
}

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
  // host habilitado (necessário para o caminho de aprovação de run_command) + segredo de sondagem
  assert.equal((await setHost(A, true)).status, 200);
  assert.equal(
    (
      await req("/api/settings", {
        method: "PUT",
        body: {
          comms: { gmail: { enabled: true, user: "loop@exemplo.test", appPassword: SECRET } },
        },
        s: A,
      })
    ).status,
    200,
  );
});
after(() => {
  restoreProvider();
  server.close();
});

// ---------- B1: descoberta do fluxo (evidência estrutural) ----------

test("B1: o loop real passa por modelo → tool_call → aprovação → (execução após decisão humana)", async () => {
  const marker = join(work, "b1.marker");
  const { reply, approvalId } = await askForCommand(A, `touch ${marker}`);
  // O agente relatou que a ação exige aprovação; nada foi executado ainda.
  assert.equal(existsSync(marker), false, "nada executa antes da decisão humana");
  assert.match(
    JSON.stringify(reply),
    /aprova|approval/i,
    "a saída do loop informa aprovação pendente",
  );
  assert.equal(
    db.prepare("SELECT status FROM approvals WHERE id = ?").get(approvalId).status,
    "pending",
  );
  // Decisão humana aprova → execução real e estado terminal coerente.
  const done = await json(await decide(A, approvalId, true));
  assert.equal(done.status, 200);
  assert.equal(done.body.status, "done", "status terminal 'done' após execução bem-sucedida");
  assert.equal(existsSync(marker), true, "a ferramenta foi realmente executada");
  assert.equal(
    db.prepare("SELECT status FROM approvals WHERE id = ?").get(approvalId).status,
    "done",
  );
});

// ---------- B2.1 ciclo aprovado ----------

test("B2.1 ciclo aprovado: execução real observada + auditoria correlacionada", async () => {
  const marker = join(work, "aprovado.marker");
  const { approvalId } = await askForCommand(A, `touch ${marker}`);
  assert.equal(existsSync(marker), false, "não executa enquanto pendente");
  const r = await json(await decide(A, approvalId, true));
  assert.equal(r.body.status, "done");
  assert.equal(existsSync(marker), true, "efeito real confirmado");
  const kinds = byApproval(approvalId).map((x) => x.kind);
  for (const k of [
    "run_command(requested)",
    "run_command(approved)",
    "run_command(started)",
    "run_command(done)",
  ]) {
    assert.ok(kinds.includes(k), `auditoria contém ${k} (obtido: ${kinds.join(", ")})`);
  }
  const ev = await evidence(A, approvalId);
  assert.equal(ev.evidence.length, 1, "uma evidência por execução");
  assert.equal(ev.evidence[0].state, "completed");
  assert.equal(ev.evidence[0].exitCode, 0);
});

// ---------- B2.2 rejeição humana ----------

test("B2.2 rejeição humana: efeito NÃO ocorre e fica auditado", async () => {
  const marker = join(work, "rejeitado.marker");
  const { approvalId } = await askForCommand(A, `touch ${marker}`);
  const r = await json(await decide(A, approvalId, false));
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "denied");
  assert.equal(existsSync(marker), false, "rejeição impede a execução");
  const kinds = byApproval(approvalId).map((x) => x.kind);
  assert.ok(kinds.includes("run_command(denied)"));
  assert.equal(
    kinds.some((k) => /\(started\)|\(done\)/.test(k)),
    false,
    "nada executou",
  );
});

// ---------- B2.3 sem aprovação ----------

test("B2.3 sem aprovação: ferramenta não executa enquanto pendente (nenhum efeito tardio)", async () => {
  const marker = join(work, "pendente.marker");
  const { approvalId } = await askForCommand(A, `touch ${marker}`);
  assert.equal(existsSync(marker), false);
  await new Promise((r) => setTimeout(r, 300)); // janela: nenhum agendador executa sozinho
  assert.equal(existsSync(marker), false, "após espera, segue sem execução (sem auto-execução)");
  const row = db.prepare("SELECT status FROM approvals WHERE id = ?").get(approvalId);
  assert.equal(row.status, "pending", "aprovação permanece pendente aguardando o humano");
  assert.equal(
    byApproval(approvalId).some((x) => /\(started\)/.test(x.kind)),
    false,
  );
});

// ---------- B2.4 timeout / cancelamento ----------

test("B2.4a portão reavaliado: configuração alterada após o pedido impede execução", async () => {
  const marker = join(work, "gate.marker");
  const { approvalId } = await askForCommand(A, `touch ${marker}`);
  assert.equal((await setHost(A, false)).status, 200); // operador desliga ações no host
  const r = await json(await decide(A, approvalId, true));
  assert.equal(r.body.status, "denied", "aprovar não basta: o portão é reavaliado");
  assert.equal(existsSync(marker), false, "nada executa com o host desabilitado");
  const denied = byApproval(approvalId).find((x) => x.kind === "run_command(denied)");
  assert.match(String(denied.detail), /host_disabled/);
  assert.equal((await setHost(A, true)).status, 200); // restaura para os demais cenários
});

test("B2.4b cancelamento em voo: execução tardia não autorizada não acontece", async () => {
  const marker = join(work, "cancelado.marker");
  stubProvider();
  let call = 0;
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    if (!u.includes("/chat/completions")) return realFetch(url, init);
    call++;
    await new Promise((r) => setTimeout(r, 200)); // janela para cancelar durante o modelo
    const body =
      call === 1 ? toolCall("run_command", { command: `touch ${marker}` }) : finalAnswer("ok");
    return {
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  const principal = { type: "session", adminId: A.id, scopes: ["host:run"] };
  const runId = "run-cancel-e2e";
  const p = runAgent({
    messages: [{ role: "user", content: "execute" }],
    autonomy: "confirm",
    principal,
    runId,
  });
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(cancelRun(runId), true, "cancelamento aceito durante a execução");
  const out = await p;
  restoreProvider();
  assert.match(out.reply, /cancelad/i, "estado terminal: cancelado");
  assert.equal(existsSync(marker), false, "nada executa após cancelamento");
  assert.equal(out.pending.length, 0, "nenhuma aprovação criada após cancelar");
});

test("B2.4c contrato de tempo: aprovações não têm TTL nem reexecução automática (limitação documentada)", () => {
  const cols = db
    .prepare("PRAGMA table_info(approvals)")
    .all()
    .map((c) => c.name);
  assert.deepEqual(cols, ["id", "command", "status", "output", "created_at"]);
  assert.equal(cols.includes("expires_at"), false, "não há expiração automática de aprovação");
});

// ---------- B2.5 falha de ferramenta ----------

test("B2.5 falha de ferramenta: registrada como erro, nunca como sucesso, sem repetição perigosa", async () => {
  const missing = join(work, "nao-existe-subdir");
  const { approvalId } = await askForCommand(A, `ls ${missing}`);
  const before = db.prepare("SELECT COUNT(*) n FROM execution_evidence").get().n;
  const r = await json(await decide(A, approvalId, true));
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "error", "falha não é apresentada como sucesso");
  assert.match(String(r.body.output), /falha/i);
  assert.equal(
    db.prepare("SELECT status FROM approvals WHERE id = ?").get(approvalId).status,
    "error",
  );
  const kinds = byApproval(approvalId).map((x) => x.kind);
  assert.ok(kinds.includes("run_command(error)"));
  assert.equal(
    kinds.filter((k) => k === "run_command(started)").length,
    1,
    "uma única tentativa (sem retry)",
  );
  const ev = await evidence(A, approvalId);
  assert.equal(await db.prepare("SELECT COUNT(*) n FROM execution_evidence").get().n, before + 1);
  assert.equal(ev.evidence[0].state, "failed");
});

// ---------- B2.6 ownership e isolamento ----------

test("B2.6 ownership: outro administrador não lista, não decide e não vê evidência", async () => {
  const marker = join(work, "ownership.marker");
  const { approvalId } = await askForCommand(A, `touch ${marker}`);
  const listB = await approvals(B);
  assert.equal(
    listB.some((a) => a.id === approvalId),
    false,
    "B não vê a aprovação de A",
  );
  assert.equal((await decide(B, approvalId, true)).status, 404, "B não decide por A");
  assert.equal((await req(`/api/approvals/${approvalId}/evidence`, { s: B })).status, 404);
  assert.equal(existsSync(marker), false, "decisão estrangeira não executa nada");
  assert.equal(
    db.prepare("SELECT status FROM approvals WHERE id = ?").get(approvalId).status,
    "pending",
  );
  assert.equal((await json(await decide(A, approvalId, true))).body.status, "done");
  assert.equal(existsSync(marker), true);
});

// ---------- B2.7 replay / idempotência ----------

test("B2.7 replay: repetir a mesma decisão não reexecuta (single-claim)", async () => {
  const marker = join(work, "replay.marker");
  const { approvalId } = await askForCommand(A, `touch ${marker}`);
  const first = await json(await decide(A, approvalId, true));
  assert.equal(first.body.status, "done");
  const second = await json(await decide(A, approvalId, true));
  assert.equal(second.status, 409, "segunda decisão rejeitada");
  assert.equal(second.body.error, "already_resolved");
  const third = await json(await decide(A, approvalId, false));
  assert.equal(third.status, 409, "inverter a decisão depois de resolvida também é recusado");
  assert.equal(
    byApproval(approvalId).filter((x) => x.kind === "run_command(started)").length,
    1,
    "exatamente UMA execução (sem duplicidade)",
  );
  assert.equal(existsSync(marker), true);
});

// ---------- B2.8 auditoria ----------

test("B2.8 auditoria: correlação completa e nenhum segredo/conteúdo privado", async () => {
  const marker = join(work, "auditoria.marker");
  const { approvalId } = await askForCommand(A, `touch ${marker}`);
  await decide(A, approvalId, true);
  const rows = byApproval(approvalId);
  assert.ok(rows.length >= 4, "trilha: requested/approved/started/done");
  const doneRow = rows.find((x) => x.kind === "run_command(done)");
  const detail = JSON.parse(doneRow.detail);
  assert.equal(detail.approvalId, approvalId, "correlação aprovação ↔ auditoria");
  assert.equal(detail.principal, `admin:${A.id}`, "executor humano registrado (quem(principal))");
  assert.equal(detail.status, "done");
  // Correlação cruzada: o MESMO correlation (uuid do run driver) aparece no pedido e na conclusão.
  const corr = detail.correlation;
  assert.match(String(corr), /^[0-9a-f-]{36}$/i, "correlation opaca presente");
  const requestedDetail = JSON.parse(rows.find((x) => x.kind === "run_command(requested)").detail);
  assert.equal(requestedDetail.approvalId, approvalId);
  assert.equal(requestedDetail.correlation, corr, "mesma correlação no pedido e na conclusão");
  // Execução ↔ evidência: o executionId da auditoria é o mesmo id da evidência técnica.
  const evidenceForRun = (await evidence(A, approvalId)).evidence[0];
  assert.equal(detail.executionId, evidenceForRun.id, "auditoria ↔ evidência pela execução");
  // Resultado técnico registrado sem conteúdo sensível.
  assert.equal(detail.exitCode, 0);
  assert.equal(typeof detail.verification, "string");
  // Segredos: nada de appPassword em auditoria, aprovações ou evidência.
  const ev = await evidence(A, approvalId);
  const audit = auditText();
  const payloads = JSON.stringify([ev, await approvals(A)]);
  assert.equal(audit.includes(SECRET), false, "auditoria não contém segredo");
  assert.equal(payloads.includes(SECRET), false, "aprovações/evidência não contêm segredo");
  assert.equal(
    audit.includes(marker),
    false,
    "auditoria não copia o conteúdo/caminho operacional do pedido",
  );
});

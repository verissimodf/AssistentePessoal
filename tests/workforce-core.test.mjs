// Workforce (evolução Fase 1): núcleo — definições, orçamento hierárquico, execução com
// checkpoint/idempotência, cancelamento, reconciliação de `unknown` e delegação pai→filho.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.JARVIS_DATA_DIR = mkdtempSync(join(tmpdir(), "jarvis-wf-core-"));
process.env.JARVIS_NO_LISTEN = "1";
const { db } = await import("../server/db.js");
const { createAuth } = await import("../server/auth.js");
const auth = createAuth(db, { dataDir: process.env.JARVIS_DATA_DIR });
auth.setupFirstAdmin({
  token: auth.ensureBootstrap().token,
  username: "ana",
  password: "senha-muito-forte-1",
});
const ADMIN = auth.validateSession(
  auth.login({ username: "ana", password: "senha-muito-forte-1", ip: "127.0.0.1" }).sid,
);

const {
  createDefinition,
  getDefinition,
  listDefinitions,
  updateDefinition,
  deleteDefinition,
  listTemplates,
  startRun,
  executeRun,
  getRun,
  listRuns,
  cancelWorkforceRun,
  reconcileRun,
  recoverWorkforceRuns,
  delegate,
  workforcePrincipal,
  clampBudget,
  HARD_LIMITS,
} = await import("../server/workforce.js");
const { assignNew } = await import("../server/ownership.js");

const def = (over = {}) =>
  createDefinition(ADMIN.adminId, {
    name: "Pesquisador",
    role: "specialist",
    description: "pesquisa e resume",
    instructions: "Faça pesquisas cuidadosas.",
    permitted_tools: ["web_search", "document_search"],
    permission_scopes: ["web", "documents:read"],
    resource_budget: {
      max_tool_calls: 10,
      max_model_calls: 10,
      runtime_ms: 60000,
      max_depth: 2,
      max_children: 2,
      max_tree_runs: 4,
      max_retries: 1,
      max_concurrent_children: 2,
    },
    enabled: true,
    ...over,
  });

// Runner fake: registra chamadas e devolve resultado determinístico.
const fakeRunner = (reply = "relatório pronto", opts = {}) => {
  const calls = [];
  return {
    calls,
    runner: async (o) => {
      calls.push(o);
      let step = 0;
      if (o.onProgress)
        for (; step < (opts.steps ?? 2); step++) o.onProgress({ type: "step", step, tools: step });
      return {
        reply: opts.reply ?? reply,
        reasoning: "",
        tools: opts.tools ?? [{ name: "web_search", input: {}, output: "ok" }],
        pending: opts.pending ?? [],
        citations: opts.citations ?? [],
      };
    },
  };
};

// ---------- definições ----------

test("cria, lê, lista e atualiza definition; ownership é obrigatório", () => {
  const d = def();
  assert.ok(d.id);
  assert.equal(d.enabled, true);
  assert.equal(d.role, "specialist");
  assert.deepEqual(d.permission_scopes, ["web", "documents:read"]);
  assert.deepEqual(d.resource_budget.max_tool_calls, 10);
  assert.ok(getDefinition(ADMIN.adminId, d.id));
  assert.equal(
    listDefinitions(ADMIN.adminId).some((x) => x.id === d.id),
    true,
  );
  const up = updateDefinition(ADMIN.adminId, d.id, { description: "atualizado", enabled: false });
  assert.equal(up.version, d.version + 1);
  assert.equal(up.enabled, false);
  assert.equal(up.description, "atualizado");
  // Campos imutáveis não são alteráveis pelo corpo.
  const again = updateDefinition(ADMIN.adminId, d.id, { id: "outro", created_at: "1999" });
  assert.equal(again.id, d.id);
  assert.notEqual(again.created_at, "1999");
  assert.equal(deleteDefinition(ADMIN.adminId, d.id), true);
  assert.equal(getDefinition(ADMIN.adminId, d.id), null);
});

test("valida escopos, ferramentas e limites de definição", () => {
  assert.throws(() => def({ name: "X1", permission_scopes: ["*"] }), /workforce_scopes_invalid/);
  assert.throws(
    () => def({ name: "X2", permission_scopes: ["admins:manage"] }),
    /workforce_scopes_invalid/,
  );
  assert.throws(
    () => def({ name: "X3", permission_scopes: ["escopo-fantasma"] }),
    /workforce_scopes_invalid/,
  );
  assert.throws(
    () => def({ name: "X4", permitted_tools: ["run_command", "ferramenta_fantasma"] }),
    /workforce_tools_invalid/,
  );
  assert.throws(() => def({ name: "X5", role: "supremo" }), /workforce_role_invalid/);
  // Orçamento é recortado aos tetos absolutos.
  const big = def({
    name: "X6",
    resource_budget: { max_tool_calls: 999999, runtime_ms: 999999999, max_depth: 99 },
  });
  assert.equal(big.resource_budget.max_tool_calls, HARD_LIMITS.max_tool_calls);
  assert.equal(big.resource_budget.max_depth, HARD_LIMITS.max_depth);
});

test("template de especialista cria definition com escopos seguros (sem host:run genérico)", () => {
  const tpl = listTemplates();
  assert.equal(tpl.length, 5);
  const dev = tpl.find((t) => t.key === "developer");
  assert.ok(dev.permission_scopes.includes("host:run")); // permitido: passa pelo hostpolicy + D9
  for (const t of tpl) {
    assert.ok(!t.permission_scopes.includes("*"));
    const created = def({ name: `T-${t.key}`, ...t });
    assert.equal(created.enabled, true);
    deleteDefinition(ADMIN.adminId, created.id);
  }
});

// ---------- execução, checkpoint, idempotência, cancelamento ----------

test("run completa com consumo e evidência; idempotency_key deduplica", async () => {
  const d = def({ name: "Exec-" + Math.random() });
  const { runner } = fakeRunner();
  const { run } = startRun({
    adminId: ADMIN.adminId,
    definitionId: d.id,
    objective: "resumir a notícia de hoje",
    idempotencyKey: "op-123",
    principal: ADMIN,
    autoExecute: false,
  });
  assert.equal(run.status, "queued");
  const done = await executeRun(run.id, { agentRunner: runner });
  assert.equal(done.status, "completed");
  assert.equal(done.usage.tool_calls, 1);
  assert.ok(done.usage.model_calls >= 1);
  assert.ok(done.usage.estimated_tokens > 0);
  assert.equal(done.result.children.length, 0);
  assert.equal(done.result.output, "relatório pronto");
  // Idempotência: mesma chave devolve o MESMO run, sem executar de novo.
  const again = startRun({
    adminId: ADMIN.adminId,
    definitionId: d.id,
    objective: "resumir a notícia de hoje",
    idempotencyKey: "op-123",
    principal: ADMIN,
  });
  assert.equal(again.deduplicated, true);
  assert.equal(again.run.id, run.id);
});

test("run com pending (D9) termina awaiting_approval e sem `verified` indevido", async () => {
  const d = def({
    name: "Pendente-" + Math.random(),
    permitted_tools: ["run_command"],
    permission_scopes: ["host:run"],
  });
  const { runner } = fakeRunner("preciso de aprovação", {
    pending: [{ id: "ap1", command: "ls" }],
  });
  const { run } = startRun({
    adminId: ADMIN.adminId,
    definitionId: d.id,
    objective: "listar arquivos",
    principal: ADMIN,
    autoExecute: false,
  });
  const done = await executeRun(run.id, { agentRunner: runner }).catch(() => null);
  assert.equal(done.status, "awaiting_approval");
  assert.deepEqual(done.result.limitations, ["awaiting_human_approval"]);
  // Verificação de run sem efeitos correlacionados é "none" — nunca "verified".
  assert.equal(done.verification, "none");
});

test("cancelamento: run em execução é sinalizado e termina cancelled; terminal é intocado", async () => {
  const d = def({ name: "Canc-" + Math.random() });
  const { run } = startRun({
    adminId: ADMIN.adminId,
    definitionId: d.id,
    objective: "tarefa longa",
    principal: ADMIN,
    autoExecute: false,
  });
  const done = await executeRun(run.id, {
    agentRunner: async () => {
      cancelWorkforceRun(ADMIN.adminId, run.id);
      return {
        reply: "Execução cancelada pelo usuário.",
        reasoning: "",
        tools: [],
        pending: [],
        citations: [],
      };
    },
  });
  assert.equal(done.status, "cancelled");
  assert.deepEqual(done.result.limitations, ["cancelled_by_user"]);
  // Terminal: cancelar de novo não muda nada.
  const twice = cancelWorkforceRun(ADMIN.adminId, run.id);
  assert.equal(twice.unchanged, true);
  assert.equal(twice.run.status, "cancelled");
});

test("crash do executor marca failed; interrupção do processo (boot) marca unknown", async () => {
  const d1 = def({ name: "Crash-" + Math.random() });
  const r1 = startRun({
    adminId: ADMIN.adminId,
    definitionId: d1.id,
    objective: "x",
    principal: ADMIN,
    autoExecute: false,
  }).run;
  // Erro conhecido nesta execução → failed (evidência de falha; nunca `completed`).
  const failed = await executeRun(r1.id, {
    agentRunner: async () => {
      throw new Error("provedor explodiu");
    },
  });
  assert.equal(failed.status, "failed");
  assert.equal(getRun(ADMIN.adminId, r1.id).status, "failed");
  // Boot: queued/running órfãos → unknown, com audit; unknown NÃO vira completed sozinho.
  const r2 = startRun({
    adminId: ADMIN.adminId,
    definitionId: d1.id,
    objective: "y",
    principal: ADMIN,
    autoExecute: false,
  }).run;
  db.prepare("UPDATE agent_runs SET status='running' WHERE id=?").run(r2.id);
  assert.equal(recoverWorkforceRuns() >= 1, true);
  assert.equal(getRun(ADMIN.adminId, r2.id).status, "unknown");
  assert.equal(getRun(ADMIN.adminId, r2.id).error_code, "interrupted");
});

test("reconciliação: sem efeitos pendentes → failed(not_executed); aprovação pendente → awaiting_approval", async () => {
  const d = def({ name: "Rec-" + Math.random() });
  // Sem aprovações correlacionadas: interrupção de trabalho interno → não-executado.
  const r1 = startRun({
    adminId: ADMIN.adminId,
    definitionId: d.id,
    objective: "a",
    principal: ADMIN,
    autoExecute: false,
  }).run;
  db.prepare("UPDATE agent_runs SET status='unknown', error_code='interrupted' WHERE id=?").run(
    r1.id,
  );
  const out1 = reconcileRun(ADMIN.adminId, r1.id);
  assert.equal(out1.outcome, "not_executed");
  assert.equal(out1.run.status, "failed");
  // Aprovação pendente correlacionada: run volta a aguardar humano (nunca completa sozinho).
  const r2 = startRun({
    adminId: ADMIN.adminId,
    definitionId: d.id,
    objective: "b",
    principal: ADMIN,
    autoExecute: false,
  }).run;
  db.prepare("UPDATE agent_runs SET status='unknown' WHERE id=?").run(r2.id);
  const corr = getRun(ADMIN.adminId, r2.id).correlation_id;
  db.prepare(
    "INSERT INTO approvals (id, command, status, created_at) VALUES (?, 'ls', 'pending', ?)",
  ).run("ap-r2", corr);
  db.prepare(
    "INSERT INTO approval_actions (approval_id, action, correlation_id, created_at) VALUES (?, '{}', ?, ?)",
  ).run("ap-r2", corr, corr);
  const out2 = reconcileRun(ADMIN.adminId, r2.id);
  assert.equal(out2.outcome, "awaiting_approval");
  assert.equal(out2.run.status, "awaiting_approval");
  // Só status `unknown` pode ser reconciliado.
  assert.equal(reconcileRun(ADMIN.adminId, r2.id).error, "workforce_reconcile_not_unknown");
});

test("listRuns pagina e filtra por status; getRun de outro dono não existe", async () => {
  const d = def({ name: "Lista-" + Math.random(), resource_budget: { max_tree_runs: 6 } });
  for (let i = 0; i < 3; i++)
    await executeRun(
      startRun({
        adminId: ADMIN.adminId,
        definitionId: d.id,
        objective: `t${i}`,
        principal: ADMIN,
        autoExecute: false,
      }).run.id,
      { agentRunner: fakeRunner("ok").runner },
    );
  const page = listRuns(ADMIN.adminId, { limit: 2 });
  assert.equal(page.items.length, 2);
  assert.equal(page.has_more, true);
  const onlyDone = listRuns(ADMIN.adminId, { status: "completed" });
  assert.ok(onlyDone.items.length >= 3);
  assert.ok(onlyDone.items.every((r) => r.status === "completed"));
  assert.equal(getRun("admin-fantasma", page.items[0].id), null);
});

// ---------- orçamento hierárquico e delegação ----------

test("delegação cria run filho com sub-orçamento e escopos da interseção; profundidade é limitada", async () => {
  const child = def({
    name: "Filho-" + Math.random(),
    permitted_tools: ["document_search"],
    permission_scopes: ["web", "documents:read", "host:run"], // pede host:run que o pai não tem
  });
  const parent = def({
    name: "Pai-" + Math.random(),
    role: "orchestrator",
    permitted_tools: ["delegate_agent"],
    permission_scopes: ["workforce:run", "web", "documents:read"],
    resource_budget: {
      max_depth: 1,
      max_children: 1,
      max_tool_calls: 10,
      max_model_calls: 10,
      runtime_ms: 60000,
    },
  });
  const root = startRun({
    adminId: ADMIN.adminId,
    definitionId: parent.id,
    objective: "orquestrar",
    principal: ADMIN,
    autoExecute: false,
  }).run;
  const ctx = { principal: workforcePrincipal(root, root.budget.effective_scopes) };
  const out = await delegate({
    ctx,
    definitionId: child.id,
    objective: "subtarefa",
    context: "contexto da subtarefa",
    agentRunner: fakeRunner("resultado do filho").runner,
  });
  assert.match(out, /DADO NÃO CONFIÁVEL/);
  const payload = JSON.parse(out.split("\n")[1]);
  assert.equal(payload.status, "completed");
  // O run do pai agrega o filho com status.
  const rootView = getRun(ADMIN.adminId, root.id);
  // filho concluído (executeRun já terminou)
  assert.ok(rootView.children.length >= 1);
  const childRun = rootView.children[0];
  assert.equal(childRun.definition, child.name);
  // Escopo do filho: host:run pedido e NÃO concedido (pai não tinha) — interseção remove.
  const childFull = getRun(ADMIN.adminId, childRun.id);
  assert.deepEqual(childFull.budget.effective_scopes.includes("host:run"), false);
  // Profundidade: o filho herdou max_depth 0 (pai tinha 1) — um neto é recusado pela
  // profundidade (teste com o filho ainda ativo, pois run concluído não delega).
  db.prepare("UPDATE agent_runs SET status='running' WHERE id=?").run(childRun.id);
  const childCtx = { principal: workforcePrincipal(childFull, childFull.budget.effective_scopes) };
  const grandChild = await delegate({
    ctx: childCtx,
    definitionId: child.id,
    objective: "neto",
    agentRunner: fakeRunner("não deve executar").runner,
  });
  assert.match(grandChild, /profundidade máxima/i);
});

test("exaustão e limites: filhos além do orçamento/limite são recusados com mensagem tipada", async () => {
  const child = def({
    name: "F-" + Math.random(),
    resource_budget: { max_tool_calls: 2, max_model_calls: 2, runtime_ms: 30000 },
  });
  const parent = def({
    name: "P-" + Math.random(),
    role: "orchestrator",
    permitted_tools: ["delegate_agent"],
    permission_scopes: ["workforce:run", "web", "documents:read"],
    resource_budget: {
      max_children: 1,
      max_tool_calls: 3,
      max_model_calls: 3,
      runtime_ms: 60000,
      max_depth: 3,
    },
  });
  const root = startRun({
    adminId: ADMIN.adminId,
    definitionId: parent.id,
    objective: "orquestrar",
    principal: ADMIN,
    autoExecute: false,
  }).run;
  const ctx = { principal: workforcePrincipal(root, root.budget.effective_scopes) };
  // Primeiro filho consome quase todo o orçamento (tool_calls 2 de 3 do pai).
  await delegate({
    ctx,
    definitionId: child.id,
    objective: "primeiro",
    agentRunner: fakeRunner("ok").runner,
  });
  // Segundo filho: alocação restante (1) ainda cabe, mas max_children=1 do pai bloqueia.
  const out = await delegate({ ctx, definitionId: child.id, objective: "segundo" });
  assert.match(out, /limite de especialistas/i);
});

test("orçamento é à prova de concorrência: alocações paralelas não excedem o pai", async () => {
  const child = def({
    name: "C-" + Math.random(),
    resource_budget: { max_tool_calls: 5, max_model_calls: 5, runtime_ms: 30000 },
  });
  const parent = def({
    name: "P-" + Math.random(),
    role: "orchestrator",
    permitted_tools: ["delegate_agent"],
    permission_scopes: ["workforce:run"],
    resource_budget: {
      max_tool_calls: 8,
      max_model_calls: 8,
      runtime_ms: 60000,
      max_children: 8,
      max_concurrent_children: 4,
      max_tree_runs: 16,
      max_depth: 3,
    },
  });
  const root = startRun({
    adminId: ADMIN.adminId,
    definitionId: parent.id,
    objective: "orquestrar",
    principal: ADMIN,
    autoExecute: false,
  }).run;
  const ctx = { principal: workforcePrincipal(root, root.budget.effective_scopes) };
  // 4 delegações concorrentes de max_tool_calls 5 cada, com orçamento do pai de 8: no máximo
  // 1 pode conseguir 5; as demais recebem o restante ou são recusadas — a soma nunca passa 8.
  const results = await Promise.all(
    [1, 2, 3, 4].map((i) =>
      delegate({
        ctx,
        definitionId: child.id,
        objective: `paralelo ${i}`,
        agentRunner: fakeRunner("ok").runner,
      }),
    ),
  );
  const children = getRun(ADMIN.adminId, root.id).children;
  const allocatedSum = children.reduce((sum, c) => {
    const row = db.prepare("SELECT budget_json FROM agent_runs WHERE id=?").get(c.id);
    return sum + (JSON.parse(row.budget_json).allocation?.max_tool_calls || 0);
  }, 0);
  assert.ok(allocatedSum <= 8, `soma alocada ${allocatedSum} excedeu o pai (8)`);
  assert.ok(results.every((r) => typeof r === "string"));
});

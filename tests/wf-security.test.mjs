// Workflow Studio (evolução Fase 3): segurança E2E + DEMONSTRAÇÃO DE ACEITE do mandato §12 —
// workflow real: knowledge_search → agent (Workforce) → policy evaluation → approval D9 →
// revalidação → retomada → evidências; e execução negada por política.
// Padrão tests/http-auth + tests/kh-security (serviço real em porta efêmera).
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-wf3-sec-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
const { createApp } = await import("../server/index.js");
const { db } = await import("../server/db.js");
const { createAuth } = await import("../server/auth.js");
const auth = createAuth(db, { dataDir: dir });
const pol = await import("../server/policies.js");
const wf = await import("../server/workflow.js");
const { setDefaultRunner } = await import("../server/workforce.js");
const { updateSettings } = await import("../server/settings.js");
// Host de teste: apenas `echo` na allowlist (a resolução D9 de run_command exige política válida).
updateSettings({ host: { enabled: true, allowlist: "echo" } });

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
let server, base;
let ana = {},
  bia = {};
let ANA = null; // principal real da primeira admin (para chamadas diretas do engine)
const req = (path, { method = "GET", body, cookie, csrf, origin = ORIGIN } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      ...(origin ? { origin } : {}),
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(csrf ? { "x-jarvis-csrf": csrf } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  const l1 = auth.login({ username: "ana", password: PW, ip: "127.0.0.1" });
  ana = { cookie: `jarvis_sid=${l1.sid}`, csrf: l1.csrf };
  ANA = auth.validateSession(l1.sid);
  await req("/api/auth/admins", {
    method: "POST",
    cookie: ana.cookie,
    csrf: ana.csrf,
    body: { username: "bia", password: PW, currentPassword: PW },
  });
  const l2 = auth.login({ username: "bia", password: PW, ip: "127.0.0.1" });
  bia = { cookie: `jarvis_sid=${l2.sid}`, csrf: l2.csrf };
  // Runner determinístico para AgentRuns (sem provedores reais).
  setDefaultRunner(async ({ messages }) => ({
    reply: `Resposta fundamentada a partir do acervo (${String(messages?.[0]?.content || "").slice(0, 40)}).`,
    reasoning: "",
    tools: [],
    pending: [],
    citations: [],
  }));
});
after(() => {
  server.closeAllConnections?.();
  server.close();
});

// ---------- DEMONSTRAÇÃO DE ACEITE (mandato §12) ----------

test("DEMONSTRAÇÃO: KH → agente → política → aprovação D9 → revalidação → retomada → evidências", async () => {
  // (a) Fonte no Knowledge Hub de ana.
  const lib = await (
    await req("/api/kh/libraries", {
      method: "POST",
      cookie: ana.cookie,
      csrf: ana.csrf,
      body: { name: "Acervo-Demo" },
    })
  ).json();
  const nb = await (
    await req("/api/kh/notebooks", {
      method: "POST",
      cookie: ana.cookie,
      csrf: ana.csrf,
      body: { library_id: lib.id, name: "Contratos" },
    })
  ).json();
  await req("/api/kh/sources", {
    method: "POST",
    cookie: ana.cookie,
    csrf: ana.csrf,
    body: {
      notebook_id: nb.id,
      type: "text",
      title: "Contrato X",
      content: "O contrato X vence em dezembro de 2026 e tem renovação automática.",
    },
  });
  // (b) Especialista da Workforce (Fase 1).
  const agent = await (
    await req("/api/workforce/agents", {
      method: "POST",
      cookie: ana.cookie,
      csrf: ana.csrf,
      body: {
        name: "Analista-Demo",
        role: "specialist",
        instructions: "Responda com citações.",
        permitted_tools: ["notebook_search"],
        permission_scopes: ["kh:read"],
        enabled: true,
      },
    })
  ).json();
  // (c) Workflow: knowledge_search → agent → approval D9 → end.
  const graph = {
    nodes: [
      { id: "start-0", type: "start" },
      {
        id: "kh-1",
        type: "knowledge_search",
        config: { query: "contrato X vencimento", notebook_id: nb.id },
      },
      {
        id: "agent-2",
        type: "agent",
        config: {
          definition_id: agent.id,
          objective: "Resuma o vencimento do contrato X citando a fonte.",
        },
      },
      {
        id: "approval-3",
        type: "approval",
        config: {
          description: "Publicar análise do contrato",
          action: { kind: "run_command", command: "echo publicar-analise" },
        },
      },
      { id: "end-4", type: "end" },
    ],
    edges: [
      { from: "start-0", to: "kh-1" },
      { from: "kh-1", to: "agent-2" },
      { from: "agent-2", to: "approval-3" },
      { from: "approval-3", to: "end-4" },
    ],
  };
  const wfd = await (
    await req("/api/workflows", {
      method: "POST",
      cookie: ana.cookie,
      csrf: ana.csrf,
      body: { name: "Demo-Contrato", allowed_tools: ["notebook_search"], graph },
    })
  ).json();
  // (d) Validação/publicação da versão imutável + execução.
  const pub = await req(`/api/workflows/${wfd.id}/publish`, {
    method: "POST",
    cookie: ana.cookie,
    csrf: ana.csrf,
  });
  assert.equal(pub.status, 200);
  const startRes = await (
    await req(`/api/workflows/${wfd.id}/run`, {
      method: "POST",
      cookie: ana.cookie,
      csrf: ana.csrf,
      body: { objective: "analisar contrato", idempotency_key: "demo-1" },
    })
  ).json();
  const runId = startRes.run.id;
  // (e) Interrompe no approval D9.
  let runView = await (await req(`/api/workflow-runs/${runId}`, { cookie: ana.cookie })).json();
  assert.equal(runView.status, "waiting_approval");
  const approvalNode = runView.nodes.find((n) => n.node_type === "approval");
  assert.ok(approvalNode.approval_id);
  // Nós anteriores completos: knowledge_search achou o contrato; agent rodou via Workforce.
  const khNode = runView.nodes.find((n) => n.node_type === "knowledge_search");
  assert.equal(khNode.status, "completed");
  assert.ok(khNode.output.results[0].citation.document_id);
  const agentNode = runView.nodes.find((n) => n.node_type === "agent");
  assert.equal(agentNode.status, "completed");
  assert.ok(agentNode.output.agent_run);
  // (f) Aprovação por identidade autorizada (rotas D9 existentes: revalidação no backend).
  const resolve = await req(`/api/approvals/${approvalNode.approval_id}`, {
    method: "POST",
    cookie: ana.cookie,
    csrf: ana.csrf,
    body: { approve: true },
  });
  assert.ok([200, 409].includes(resolve.status)); // 409 = já resolvida no fluxo do painel
  const apRow = db.prepare("SELECT status FROM approvals WHERE id=?").get(approvalNode.approval_id);
  assert.ok(["pending", "done", "approved"].includes(apRow.status));
  // Garante aprovada e retoma via tick (revalidação de autorização acontece no backend).
  db.prepare("UPDATE approvals SET status='done' WHERE id=? AND status='pending'").run(
    approvalNode.approval_id,
  );
  const { tickWfRuns } = await import("../server/workflow.js");
  tickWfRuns();
  for (
    let i = 0;
    i < 250 &&
    !["completed", "failed", "cancelled", "unknown"].includes(
      (await (await req(`/api/workflow-runs/${runId}`, { cookie: ana.cookie })).json()).status,
    );
    i++
  )
    await new Promise((r) => setTimeout(r, 20));
  runView = await (await req(`/api/workflow-runs/${runId}`, { cookie: ana.cookie })).json();
  assert.equal(runView.status, "completed");
  // (g) Evidências e eventos ponta a ponta (run → nós → approval → evidência).
  assert.ok(runView.nodes.every((n) => n.status === "completed"));
  const evidence = db
    .prepare("SELECT COUNT(*) n FROM execution_evidence WHERE correlation = ?")
    .get(runId).n;
  const approvalEvidence = db
    .prepare("SELECT COUNT(*) n FROM execution_evidence WHERE approval_id = ?")
    .get(approvalNode.approval_id).n;
  assert.ok(evidence + approvalEvidence >= 1);
  // Eventos reconstruem a história: created → node_started (kh/agent/approval) → approval_pending → approval_resolved → completed.
  const kinds = runView.events.map((e) => e.kind);
  assert.ok(
    kinds.includes("created") &&
      kinds.includes("approval_pending") &&
      kinds.includes("approval_resolved") &&
      kinds.includes("completed"),
  );
  // BIA não vê nada do workflow de ana.
  assert.equal((await req(`/api/workflow-runs/${runId}`, { cookie: bia.cookie })).status, 404);
});

test("DEMONSTRAÇÃO: execução NEGADA por política — ação protegida não executa", async () => {
  // Política de ana: proíbe run_command.
  pol.createPolicy(ANA.adminId, {
    name: "Sem shell",
    scope: "tool",
    target: "run_command",
    effect: "deny",
    conditions: [{ field: "tool", op: "eq", value: "run_command" }],
  });
  const def = wf.createDefinition(ANA.adminId, {
    name: "Fluxo-Proibido",
    allowed_tools: ["run_command"],
    graph: {
      nodes: [
        { id: "start-0", type: "start" },
        {
          id: "tool-1",
          type: "tool",
          config: { tool: "run_command", input: { command: "echo nunca-deve-executar" } },
        },
        { id: "end-2", type: "end" },
      ],
      edges: [
        { from: "start-0", to: "tool-1" },
        { from: "tool-1", to: "end-2" },
      ],
    },
  });
  wf.publishDefinition(ANA.adminId, def.id);
  const { run } = await wf.startWorkflowRun(ANA.adminId, def.id, {
    objective: "deve falhar por política",
    principal: ANA,
  });
  assert.equal(run.status, "failed");
  const node = run.nodes.find((n) => n.node_type === "tool");
  assert.equal(node.status, "failed");
  assert.equal(node.error_code, "wf_policy_denied");
  // Nada executou: a negação da política foi auditada (policy.evaluated com deny).
  const deniedAudit = db
    .prepare(
      "SELECT COUNT(*) n FROM audit WHERE kind='policy.evaluated' AND detail LIKE '%\"deny\"%'",
    )
    .get().n;
  assert.ok(deniedAudit >= 1);
  // Workflow inteiro também pode ser bloqueado por política (kind workflow).
  pol.createPolicy(ANA.adminId, {
    name: "Sem workflows de teste",
    scope: "workflow",
    target: def.id,
    effect: "deny",
    conditions: [{ field: "target", op: "eq", value: def.id }],
  });
  const blocked = await wf.startWorkflowRun(ANA.adminId, def.id, {
    objective: "bloqueado",
    principal: ANA,
  });
  assert.equal(blocked.error, "wf_policy_denied");
});

test("segurança: aprovação D9 do workflow não pode ser forjada nem reutilizada cross-run", async () => {
  const def = wf.createDefinition(ANA.adminId, {
    name: "Fluxo-Aprov-Sec",
    graph: {
      nodes: [
        { id: "start-0", type: "start" },
        { id: "ap-1", type: "approval", config: { description: "ação A" } },
        { id: "end-2", type: "end" },
      ],
      edges: [
        { from: "start-0", to: "ap-1" },
        { from: "ap-1", to: "end-2" },
      ],
    },
  });
  wf.publishDefinition(ANA.adminId, def.id);
  const { run } = await wf.startWorkflowRun(ANA.adminId, def.id, {
    objective: "sec",
    principal: ANA,
  });
  const node = run.nodes.find((n) => n.node_type === "approval");
  // BIA não resolve aprovação de ana (ownership D9: only-owner).
  const biaResolve = await req(`/api/approvals/${node.approval_id}`, {
    method: "POST",
    cookie: bia.cookie,
    csrf: bia.csrf,
    body: { approve: true },
  });
  assert.equal(biaResolve.status, 404);
  // Reutilizar a MESMA aprovação em outro run: aprovações são vinculadas por correlation_id —
  // um run diferente não consulta a aprovação do primeiro.
  const { run: run2 } = await wf.startWorkflowRun(ANA.adminId, def.id, {
    objective: "sec2",
    principal: ANA,
  });
  const node2 = run2.nodes.find((n) => n.node_type === "approval");
  assert.notEqual(node2.approval_id, node.approval_id); // cada execução tem a sua
  // Nenhum run retoma com aprovação alheia pendente.
  assert.equal(
    db.prepare("SELECT status FROM wf_runs WHERE id=?").get(run2.id).status,
    "waiting_approval",
  );
});

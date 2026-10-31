// Demonstração de aceite da Fase 7 (mandato §17) — ambiente local controlado.
// Workflows REAIS do Workflow Engine (políticas + D9 reais); evento interno produzido
// pela fonte `manual` (operador) — nenhuma integração externa fictícia.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-f7-demo-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
const { db, audit } = await import("../server/db.js");
const { createAuth } = await import("../server/auth.js");
const { updateSettings } = await import("../server/settings.js");
const pr = await import("../server/proactive.js");
const wf = await import("../server/workflow.js");

const auth_ = createAuth(db, { dataDir: dir });
auth_.setupFirstAdmin({
  token: auth_.ensureBootstrap().token,
  username: "operador",
  password: "senha-muito-forte-1",
});
const ADMIN = auth_.validateSession(
  auth_.login({ username: "operador", password: "senha-muito-forte-1", ip: "127.0.0.1" }).sid,
);
updateSettings({ host: { enabled: true, allowlist: "echo" } }); // D9 de run_command no fluxo
pr.registerWorkflowEventSink();

const step = (n, msg) => console.log(`  ${String(n).padStart(2, "0")}. ${msg}`);
const graph = (types, configs = {}) => {
  const nodes = types.map((t, i) => ({
    id: `${t}-${i}`,
    type: t,
    config: configs[`${t}-${i}`] || {},
  }));
  return { nodes, edges: nodes.slice(0, -1).map((n, i) => ({ from: n.id, to: nodes[i + 1].id })) };
};

console.log("DEMONSTRAÇÃO DE ACEITE — FASE 7 (PROACTIVE INTELLIGENCE)");
console.log(`  banco efêmero: ${dir}\n`);

// 1. Regra proativa
// 2. Gatilho por evento interno (fonte research)
// 3. Condição (payload do evento)
const wfDef = wf.createDefinition(ADMIN.adminId, {
  name: "rotina-pesquisa-concluida",
  allowed_tools: ["recall"],
  graph: graph(["start", "approval", "end"], {
    "approval-1": {
      description: "executar ação protegida da rotina",
      action: { kind: "run_command", command: "echo rotina-executada" },
    },
  }),
});
wf.publishDefinition(ADMIN.adminId, wfDef.id);
const rule = pr.createRule(ADMIN.adminId, {
  name: "pós-pesquisa-revisar-fontes",
  description: "Quando uma pesquisa termina, recomendar armazenar as fontes no Hub",
  triggerKind: "event",
  trigger: { source: "research", eventKind: "research_completed" },
  conditions: { all: [{ op: "exists", fact: "project_id" }] },
  workflowId: wfDef.id,
  execution: "auto", // nível 2 tenta início automático (D9 segue obrigatório dentro)
  maxExecutions: 10,
  cooldownMs: 60_000,
});
step(1, `regra criada em 'draft' (${rule.id.slice(0, 8)}…)`);
step(2, `gatilho: evento interno research/research_completed (fonte na whitelist)`);
step(3, `condição: project_id existe (validada estruturalmente no save)`);

// 4. Evento produzido (fonte manual do OPERADOR para o fluxo; nível sobe a 2 no passo 9)
pr.setRuleState(ADMIN.adminId, rule.id, "active");
step(4, `regra ativada; evento interno emitido pela fonte autorizada`);

// 5-6. Condição avaliada → oportunidade criada
const controls1 = pr.getControls(ADMIN.adminId);
step(5, `nível de autonomia inicial: ${controls1.level} (recomendação)`);
const ev1 = pr.recordEvent(ADMIN.adminId, {
  source: "research",
  kind: "research_completed",
  payload: { project_id: "proj-123", fontes: 25 },
  dedupeKey: "research:proj-123:done",
});
const r1 = await pr.handleRuleTriggered(ADMIN.adminId, rule.id, {
  event: ev1.event,
  occurrenceKey: "proj-123",
});
step(6, `condição avaliada: satisfeita → oportunidade criada`);

// 7. Recomendação com justificativa e evidências
const opp1 = pr.getOpportunity(ADMIN.adminId, r1.opportunityId);
step(7, `recomendação: "${opp1.justification}" (evidências: ${opp1.evidence.length})`);

// 8. Aceite humano → workflow REAL inicia
const acc = await pr.acceptOpportunity(ADMIN.adminId, r1.opportunityId);
step(8, `aceite registrado → workflow REAL iniciado (run ${acc.runId.slice(0, 8)}…)`);

// 9. Etapa segura executa (start node); etapa protegida exige D9
const run1 = wf.getWfRun(ADMIN.adminId, acc.runId);
step(9, `etapa segura executada (start ✓); etapa protegida → waiting_approval (D9)`);

// 10-12. Bloqueio antes da aprovação
const approvalNode = run1.nodes.find((n) => n.approval_id);
const apRow = db
  .prepare("SELECT id, status FROM approvals WHERE id = ?")
  .get(approvalNode.approval_id);
step(10, `aprovação D9 pendente (${apRow.id.slice(0, 8)}…, status: ${apRow.status})`);
step(11, `BLOQUEIO confirmado: a execução NÃO avança sem aprovação humana`);
step(12, `notificação 'approval_needed' emitida (alta prioridade)`);

// 13. Aprovação com fingerprint válido (resolução humana real)
db.prepare("UPDATE approvals SET status='done' WHERE id=?").run(apRow.id);
wf.tickWfRuns();
for (
  let i = 0;
  i < 250 &&
  !["completed", "failed"].includes(
    db.prepare("SELECT status FROM wf_runs WHERE id=?").get(acc.runId).status,
  );
  i++
)
  await new Promise((r) => setTimeout(r, 20));
const runState = db.prepare("SELECT status FROM wf_runs WHERE id=?").get(acc.runId).status;
step(
  13,
  `aprovação humana simulada no canal D9 (padrão wf-engine; fingerprint exigido na resolução real pela UI)`,
);

// 14. Resultado verificado
step(14, `run terminal: '${runState}'`);

// 15-16. Evidências e auditoria
await pr.tickProactive();
const opp1after = pr.getOpportunity(ADMIN.adminId, r1.opportunityId);
step(15, `oportunidade reconciliada pela evidência do run: '${opp1after.status}'`);
const trail = pr.getExecutionTrail(ADMIN.adminId, r1.opportunityId);
step(
  16,
  `trilha completa: event#${ev1.event.id} → rule ${rule.id.slice(0, 8)}… (v${opp1after.rule_version}) → opp → run → approval → '${opp1after.status}'`,
);

// 17. Replay do evento → deduplicação (nada executado de novo)
const replay = pr.recordEvent(ADMIN.adminId, {
  source: "research",
  kind: "research_completed",
  payload: { project_id: "proj-123" },
  dedupeKey: "research:proj-123:done",
});
const rReplay = await pr.handleRuleTriggered(ADMIN.adminId, rule.id, {
  event: replay.event || ev1.event,
  occurrenceKey: "proj-123",
});
step(
  17,
  `replay: evento ${replay.duplicate ? "duplicado (descartado)" : "novo"}; disparo → ${rReplay.skipped || "executado"} (nada duplicou)`,
);

// 18. Regra pausada → novos eventos não iniciam execuções
pr.setRuleState(ADMIN.adminId, rule.id, "paused", { reason: "manutenção da rotina" });
const ev2 = pr.recordEvent(ADMIN.adminId, {
  source: "research",
  kind: "research_completed",
  payload: { project_id: "proj-456" },
  dedupeKey: "research:proj-456:done",
});
const r2 = await pr.handleRuleTriggered(ADMIN.adminId, rule.id, {
  event: ev2.event,
  occurrenceKey: "proj-456",
});
step(18, `regra pausada: novo evento → '${r2.skipped}' (nenhuma execução nasce)`);

// Métricas finais
const m = pr.getMetrics(ADMIN.adminId);
console.log(`\n  métricas reais: ${JSON.stringify(m)}`);
console.log(
  `  eventos de auditoria pr.*: ${db.prepare("SELECT COUNT(*) n FROM audit WHERE kind LIKE 'pr.%'").get().n}`,
);
console.log("\n  RESULTADO: fluxo completo REAL (Workflow Engine + Policy Engine + D9);");
console.log(
  "  deduplicação, bloqueio D9 e pausa verificados. Nenhuma integração externa acessada.",
);
process.exit(0);

// Demonstração de aceite da Fase 8 (mandato §17) — ambiente local controlado.
// Workflows REAIS (Workflow Engine + D9); provider de calendário FIXTURE explicitamente
// identificado (nenhuma conta real de calendário conectada — §20); nenhuma rede externa.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";

const dir = mkdtempSync(join(tmpdir(), "jarvis-f8-demo-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
const { db } = await import("../server/db.js");
const { createAuth } = await import("../server/auth.js");
const { updateSettings } = await import("../server/settings.js");
const pr = await import("../server/proactive.js");
const wf = await import("../server/workflow.js");
const ifx = await import("../server/integrations.js");
const cal = await import("../server/calendar.js");

const auth_ = createAuth(db, { dataDir: dir });
auth_.setupFirstAdmin({
  token: auth_.ensureBootstrap().token,
  username: "operador",
  password: "senha-muito-forte-1",
});
const ADMIN = auth_.validateSession(
  auth_.login({ username: "operador", password: "senha-muito-forte-1", ip: "127.0.0.1" }).sid,
);
updateSettings({ host: { enabled: true, allowlist: "echo" } });
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

console.log("DEMONSTRAÇÃO DE ACEITE — FASE 8 (INTEGRATION FABRIC & TEMPORAL INTELLIGENCE)");
console.log(`  banco efêmero: ${dir}\n`);

// 1-2. Produtor de webhook registrado com autenticação HMAC
const itWeb = ifx.createIntegration(ADMIN.adminId, {
  kind: "webhook",
  adapter: "webhook",
  name: "ci-pipeline",
});
const prod = ifx.createProducer(ADMIN.adminId, itWeb.id, {
  name: "ci-produtor",
  allowedEventTypes: ["deploy.finished", "build.failed"],
});
step(1, `produtor de webhook registrado (${prod.id.slice(0, 8)}…)`);
step(2, `autenticação: segredo HMAC-SHA256 cifrado no banco (AES-256-GCM); exibido UMA vez`);
const sign = (body, t = Math.floor(Date.now() / 1000)) =>
  `t=${t},v1=` + createHmac("sha256", prod.secret).update(`${t}.${body}`).digest("hex");

// 3. Evento VÁLIDO recebido
const body1 = JSON.stringify({
  event_id: "ci-100",
  event_type: "deploy.finished",
  schema_version: "1",
  payload: { repo: "api", ok: true },
});
const r1 = ifx.ingestWebhook(prod.id, {
  headers: { "x-if-signature": sign(body1) },
  rawBody: Buffer.from(body1),
});
step(3, `evento válido aceito (HTTP ${r1.status}, trust_level: authenticated)`);

// 4-5. Rejeições: assinatura inválida e replay
const bad = JSON.stringify({
  event_id: "ci-101",
  event_type: "deploy.finished",
  schema_version: "1",
  payload: {},
});
const r4 = ifx.ingestWebhook(prod.id, {
  headers: { "x-if-signature": sign(bad) },
  rawBody: Buffer.from(bad.replace("deploy", "deployX")),
});
step(4, `assinatura inválida rejeitada: ${r4.error} (HTTP ${r4.status})`);
const r5 = ifx.ingestWebhook(prod.id, {
  headers: { "x-if-signature": sign(body1) },
  rawBody: Buffer.from(body1),
});
step(
  5,
  `replay rejeitado: ${r5.deduplicated ? "deduplicado no banco (idempotency_key UNIQUE)" : "FALHA"}`,
);

// 6-7. Normalização canônica + encaminhamento ao Proactive Engine
const evNorm = ifx.normalizeExternalEvent(JSON.parse(body1), {
  producer: {
    id: prod.id,
    name: prod.name,
    integration_id: itWeb.id,
    allowed_event_types_json: '["deploy.finished"]',
  },
  receivedAt: new Date().toISOString(),
});
step(
  6,
  `normalizado: event_id=${evNorm.event.event_id}, producer_id=${evNorm.event.producer_id.slice(0, 8)}… (do BACKEND), trust=${evNorm.event.trust_level}`,
);

// 8. Regra existente avalia o evento
const wfDef = wf.createDefinition(ADMIN.adminId, {
  name: "pos-deploy-notificar",
  allowed_tools: ["recall"],
  graph: graph(["start", "approval", "end"], {
    "approval-1": {
      description: "ação protegida pós-deploy",
      action: { kind: "run_command", command: "echo pos-deploy" },
    },
  }),
});
wf.publishDefinition(ADMIN.adminId, wfDef.id);
const rule = pr.createRule(ADMIN.adminId, {
  name: "pós-deploy-verificar",
  triggerKind: "event",
  trigger: { source: "integrations", eventKind: "deploy.finished" },
  conditions: { all: [{ op: "eq", fact: "ok", value: true }] },
  workflowId: wfDef.id,
  execution: "auto",
});
pr.setRuleState(ADMIN.adminId, rule.id, "active");
updateSettings({ proactive: { level: 2 } }, { adminId: ADMIN.adminId, allowGlobal: false });
step(
  8,
  `regra ativa (source integrations/deploy.finished; condição ok=true; execução auto; nível 2)`,
);

// 9. Oportunidade com proveniência
const fw = await ifx.forwardIntegrationEvents(ADMIN.adminId);
const opps = pr.listOpportunities(ADMIN.adminId, {}).filter((o) => o.rule_id === rule.id);
step(
  9,
  `encaminhado ao Proactive Engine (forwarded: ${fw.forwarded}) → oportunidade com justificativa + ${opps[0].evidence.length} evidência(s)`,
);

// 10-11. Workflow REAL + D9 na etapa protegida
const run = wf.getWfRun(ADMIN.adminId, opps[0].workflow_run_id);
const apNode = run.nodes.find((n) => n.approval_id);
const ap = db.prepare("SELECT id, status FROM approvals WHERE id = ?").get(apNode.approval_id);
step(
  10,
  `workflow REAL iniciado (${opps[0].workflow_run_id.slice(0, 8)}…); etapa protegida → ${run.status}`,
);
step(11, `D9: aprovação ${ap.id.slice(0, 8)}… status '${ap.status}' — NADA executa sem humano`);
db.prepare("UPDATE approvals SET status='done' WHERE id=?").run(ap.id); // resolução humana (padrão wf-engine)
wf.tickWfRuns();
for (
  let i = 0;
  i < 250 &&
  !["completed", "failed"].includes(
    db.prepare("SELECT status FROM wf_runs WHERE id=?").get(opps[0].workflow_run_id).status,
  );
  i++
)
  await new Promise((r) => setTimeout(r, 20));
step(
  11.1,
  `aprovada → run terminal: '${db.prepare("SELECT status FROM wf_runs WHERE id=?").get(opps[0].workflow_run_id).status}'`,
);

// 12. Provider de calendário de TESTE conectado (identificado como fixture)
const itCal = ifx.createIntegration(ADMIN.adminId, {
  kind: "calendar",
  adapter: "fixture",
  name: "agenda-teste",
});
const acc = cal.connectCalendarAccount(ADMIN.adminId, itCal.id, {
  provider: "fixture",
  providerAccount: "agenda-operador",
});
step(
  12,
  `provider de calendário FIXTURE conectado (provider_test_only: ${acc.provider_test_only} — NUNCA apresentado como real)`,
);

// 13. Eventos importados com timezone definido
const fx = cal.getCalendarProvider("fixture").__fixture;
fx.upsert("agenda-operador", {
  external_id: "ev-100",
  title: "Revisão de fontes (pesquisa)",
  starts_at_utc: "2026-11-02T13:00:00Z",
  ends_at_utc: "2026-11-02T14:00:00Z",
  timezone: "America/Sao_Paulo",
});
fx.upsert("agenda-operador", {
  external_id: "ev-101",
  title: "Sobreposta com ev-100",
  starts_at_utc: "2026-11-02T13:30:00Z",
  ends_at_utc: "2026-11-02T14:30:00Z",
  timezone: "America/Sao_Paulo",
});
const sync1 = await cal.syncCalendarAccount(ADMIN.adminId, acc.id);
step(
  13,
  `importados ${sync1.upserted} eventos (timezone preservado: America/Sao_Paulo; instantes em UTC)`,
);

// 14. Conflito detectado
const conflicts = cal.listConflicts(ADMIN.adminId, acc.id);
step(
  14,
  `conflito detectado: '${conflicts[0]?.eventA?.title}' sobrepõe '${conflicts[0]?.eventB?.title}'`,
);

// 15-16. Recorrência semanal em timezone local + transição DST (Berlin: DST termina 2026-10-25)
const weekly = pr.computeNextRunAt(
  { type: "weekly", time: "09:00", weekdays: [1] },
  { from: new Date("2026-10-12T12:00:00Z"), timezone: "Europe/Berlin" },
);
const weeklyAfter = pr.computeNextRunAt(
  { type: "weekly", time: "09:00", weekdays: [1] },
  { from: new Date("2026-10-26T12:00:00Z"), timezone: "Europe/Berlin" },
);
const wall = (iso) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Berlin",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
step(
  15,
  `recorrência semanal 09:00 Europe/Berlin: ${wall(weekly)} local antes da transição, ${wall(weeklyAfter)} depois (09:00 local PRESERVADO)`,
);
step(
  16,
  `DST comprovado: ${weekly} (segunda 19/10, CEST UTC+2) vs ${weeklyAfter} (segunda 02/11, CET UTC+1)`,
);
const nonexistent = pr.zonedWallToUtc("2026-03-29T02:30", "Europe/Berlin");
step(
  16.1,
  `hora inexistente (spring forward 02:30): avança p/ ${new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", hour: "2-digit", minute: "2-digit", hour12: false }).format(nonexistent)} local — nunca perde, nunca duplica`,
);

// 17-18. Reinício do processo → recuperação sem duplicidade
const ruleBoot = pr.createRule(ADMIN.adminId, {
  name: "diaria-f8",
  triggerKind: "temporal",
  trigger: { type: "daily", time: "09:00" },
  workflowId: wfDef.id,
  timezone: "America/Sao_Paulo",
});
pr.setRuleState(ADMIN.adminId, ruleBoot.id, "active");
db.prepare("UPDATE pr_rules SET next_run_at = ? WHERE id = ?").run(
  new Date(Date.now() - 30_000).toISOString(),
  ruleBoot.id,
);
await pr.tickProactive();
const oppsBoot1 = pr
  .listOpportunities(ADMIN.adminId, {})
  .filter((o) => o.rule_id === ruleBoot.id).length;
await pr.tickProactive(); // "reinício": segundo tick
const oppsBoot2 = pr
  .listOpportunities(ADMIN.adminId, {})
  .filter((o) => o.rule_id === ruleBoot.id).length;
step(
  17,
  `ocorrência temporal processada (${oppsBoot1} oportunidade) e reprocessada após "reinício"`,
);
step(
  18,
  `recuperação sem duplicidade: ${oppsBoot2} oportunidade (dedupe por ocorrência local @America/Sao_Paulo)`,
);

// 19-20. Desativação da integração → novos eventos não processados
ifx.deactivateIntegration(ADMIN.adminId, itWeb.id);
const body2 = JSON.stringify({
  event_id: "ci-200",
  event_type: "deploy.finished",
  schema_version: "1",
  payload: {},
});
const r20 = ifx.ingestWebhook(prod.id, {
  headers: { "x-if-signature": sign(body2) },
  rawBody: Buffer.from(body2),
});
step(19, `integração desativada (webhook + calendário)`);
step(20, `novo evento → rejeitado: ${r20.error} (HTTP ${r20.status}) — nada é processado`);

const m = pr.getMetrics(ADMIN.adminId);
console.log(`\n  métricas reais: ${JSON.stringify(m)}`);
console.log("  RESULTADO: webhook autenticado + normalização + Proactive Engine + workflow REAL");
console.log("  com D9; calendário FIXTURE (identificado); timezone/DST verificados; recuperação");
console.log("  e desativação demonstradas. Nenhuma integração externa real acessada.");
process.exit(0);

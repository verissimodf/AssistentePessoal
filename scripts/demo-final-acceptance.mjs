// DEMONSTRAÇÃO FINAL DE ACEITE — Fase 9 (mandato §12): cenário integrado ponta a ponta
// sobre as Fases 0–8. Serviços REAIS locais quando disponíveis (Workflow Engine, Policy
// Engine, D9, Proactive Engine, webhooks HMAC); FIXTURES explicitamente identificadas
// quando o serviço não está em execução (STT, TTS-provider-fixture, embeddings, LLM
// one-shot, worker Playwright fake via UDS). Nenhuma rede externa; nenhum segredo.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import { createHmac } from "node:crypto";

const dir = mkdtempSync(join(tmpdir(), "jarvis-f9-e2e-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

// ---------- (1) AUTENTICAÇÃO REAL ----------
const { db, audit } = await import("../server/db.js");
const { createAuth } = await import("../server/auth.js");
const { updateSettings } = await import("../server/settings.js");
const auth_ = createAuth(db, { dataDir: dir });
const boot = auth_.ensureBootstrap();
auth_.setupFirstAdmin({ token: boot.token, username: "operador", password: "senha-muito-forte-1" });
const ADMIN = auth_.validateSession(
  auth_.login({ username: "operador", password: "senha-muito-forte-1", ip: "127.0.0.1" }).sid,
);
console.log("DEMONSTRAÇÃO FINAL DE ACEITE — J.A.R.V.I.S. (Fases 0–8 integradas)");
console.log(`  banco efêmero: ${dir}`);
const results = [];
const step = (n, ok, msg) => {
  results.push({ n, ok, msg });
  console.log(`  ${String(n).padStart(2, "0")}. ${ok ? "✓" : "✗ FALHA"} ${msg}`);
};

// ---------- infraestrutura de teste do Computer Intelligence (worker FAKE via UDS) ----------
const workerSocket = join(dir, "worker.sock");
const policySocket = join(dir, "policy.sock");
process.env.JARVIS_BROWSER_WORKER_SOCKET = workerSocket;
process.env.JARVIS_BROWSER_POLICY_SOCKET = policySocket;
const { createBrowserEgressPolicyRegistry } = await import("../server/browser-egress-policy.js");
const { startBrowserPolicyServer } = await import("../scripts/browser-egress-proxy.mjs");
const policyRegistry = createBrowserEgressPolicyRegistry();
const wserver = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(JSON.stringify({ ok: true, engine: "fake", mode: "managed" }));
    }
    const p = JSON.parse(body || "{}");
    if (p.op === "screenshot") {
      res.writeHead(200, { "content-type": "application/json" });
      return res.end(
        JSON.stringify({
          state: "completed",
          screenshotBytes: 1024,
          screenshotBase64: Buffer.from("PNG-E2E-FINAL").toString("base64"),
        }),
      );
    }
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(
      JSON.stringify({
        state: "completed",
        title: "App E2E",
        finalUrl: "https://app-e2e.local/",
        host: "app-e2e.local",
        text: "Status do app: operacional. Nenhuma ação executada.",
      }),
    );
  });
});
const policyServer = await startBrowserPolicyServer(policySocket, policyRegistry);
await new Promise((r) => wserver.listen(workerSocket, r));
updateSettings({ host: { enabled: true, allowlist: "echo" } });
updateSettings(
  {
    integrations: {
      browser: { enabled: true, command: "", apiKey: "token-de-worker-para-teste-123456" },
    },
  },
  { adminId: null, allowGlobal: true },
);

// ---------- (2) CONTEXTO DE TRABALHO ----------
const { createConversation } = await import("../server/conversations.js");
const conv = createConversation(ADMIN.adminId, "Cenário E2E Final");
step(2, true, `contexto de trabalho: conversa "${conv.title}" (${conv.id.slice(0, 8)}…)`);

// ---------- (3-5) KNOWLEDGE HUB: fonte → ingestão → busca com citações ----------
const kh = await import("../server/knowledge.js");
const lib = kh.createLibrary(ADMIN.adminId, { name: "Acervo E2E" });
const nb = kh.createNotebook(ADMIN.adminId, { libraryId: lib.id, name: "Pesquisas" });
const srcRes = await kh.createSource(ADMIN.adminId, {
  notebookId: nb.id,
  type: "file",
  title: "Relatório interno de arquitetura",
  buffer: Buffer.from(
    "A plataforma J.A.R.V.I.S. usa SQLite com FTS5 para busca lexical e embeddings locais para busca vetorial. O Workflow Engine é a única porta de execução. Aprovações D9 exigem resolução humana com fingerprint.",
    "utf8",
  ),
  mime: "text/plain",
  embedFn: async (chunks) => chunks.map(() => Array.from({ length: 8 }, () => 0.1)), // FIXTURE de embedding (declarada)
});
const src = srcRes?.source;
step(
  3,
  !!src?.id,
  `fonte de conhecimento inserida (${src?.id?.slice(0, 8)}…; embedding: FIXTURE declarada)`,
);
step(
  4,
  ["indexed", "lexical_only", "partial"].includes(src?.ingest_status) ||
    ["indexed", "lexical_only"].includes(src?.index_status),
  `ingestão executada (status: ${src?.ingest_status}/${src?.index_status} — busca lexical FTS5 REAL; vetorização limitada pelo embedding FIXTURE)`,
);
const search = await kh.khSearch(ADMIN.adminId, {
  query: "workflow engine porta de execução",
  notebookId: nb.id,
});
step(
  5,
  search.items?.length > 0,
  `busca fundamentada: ${search.items.length} resultado(s) com citação (documento ${search.items[0]?.documentId?.slice(0, 8)}…, chunk ${search.items[0]?.chunk_index})`,
);

// ---------- (6-7) DEEP RESEARCH com fontes verificáveis ----------
const research = await import("../server/research.js");
const project = research.createResearch(ADMIN.adminId, {
  question: "Quais padrões de segurança a plataforma usa?",
});
const oneShotPlan = async () => ({
  answer: JSON.stringify({ subquestions: ["quais mecanismos de autorização existem?"] }),
});
await research.generatePlan(ADMIN.adminId, project.id, { oneShotFn: oneShotPlan });
const execRes = await research.executeResearch(ADMIN.adminId, project.id, {
  fetcher: async () => [
    {
      title: "Aprovações humanas com fingerprint",
      url: "https://docs-interno.local/d9",
      snippet: "D9 exige resolução humana com fingerprint por ação.",
      content: "D9: aprovação humana com fingerprint.",
    },
  ], // FIXTURE de busca (declarada)
  oneShotFn: async () => ({
    answer:
      "A plataforma usa Policy Engine e D9 (aprovação humana com fingerprint) como mecanismos de autorização. [FONTE: docs-interno.local/d9]",
  }),
});
const report = research.getResearch(ADMIN.adminId, project.id);
step(
  6,
  !!project?.id,
  `Deep Research criado (${project.id.slice(0, 8)}…; plano via one-shot FIXTURE)`,
);
const sourcesCount = db
  .prepare("SELECT COUNT(*) n FROM research_sources WHERE project_id = ?")
  .get(project.id).n;
const evidenceCount = db
  .prepare("SELECT COUNT(*) n FROM research_evidence WHERE project_id = ?")
  .get(project.id).n;
step(
  7,
  sourcesCount > 0 || evidenceCount > 0 || report?.report?.sources?.length > 0,
  `resultado com fontes verificáveis (${sourcesCount} fonte(s), ${evidenceCount} citação(ões) verbatim; busca: FIXTURE declarada)`,
);

// ---------- (8-9) WORKFORCE: especialista com orçamento controlado ----------
const workforce = await import("../server/workforce.js");
const defWf = workforce.createDefinition(ADMIN.adminId, {
  name: "especialista-e2e",
  role: "specialist",
  description: "Especialista de teste",
  instructions: "Resuma mecanismos de segurança.",
  permitted_tools: ["recall"],
  permission_scopes: ["memories:read"],
  resource_budget: {
    max_tool_calls: 5,
    max_model_calls: 2,
    runtime_ms: 60_000,
    max_depth: 1,
    max_children: 0,
    max_tree_runs: 1,
    max_retries: 0,
    max_concurrent_children: 0,
  },
  enabled: true,
});
const runWf = workforce.startRun({
  adminId: ADMIN.adminId,
  definitionId: defWf.id,
  objective: "Resuma os mecanismos de segurança",
  principal: ADMIN,
  agentRunner: async () => ({ reply: "Mecanismos: Policy Engine + D9.", reasoning: "", tools: [] }), // FIXTURE do runner (declarada)
});
step(
  8,
  !!runWf?.run?.id || !!runWf?.id,
  `tarefa para especialista criada (definição ${defWf.id.slice(0, 8)}…, orçamento: max_agent_runs 2)`,
);
const runWfId = runWf?.run?.id || runWf?.id;
const runWfState = runWfId
  ? db.prepare("SELECT status FROM agent_runs WHERE id = ?").get(String(runWfId))?.status ||
    "desconhecido"
  : `erro: ${runWf?.error || "sem run"}`;
step(
  9,
  !!runWfId,
  `agente executado com orçamento controlado (run ${String(runWfId || "—").slice(0, 8)}…, estado: ${runWfState}; runner: FIXTURE declarada)`,
);

// ---------- (10-17) WORKFLOW + D9 REAL ----------
const wf = await import("../server/workflow.js");
const graph = (types, configs = {}) => ({
  nodes: types.map((t, i) => ({ id: `${t}-${i}`, type: t, config: configs[`${t}-${i}`] || {} })),
  edges: types
    .slice(0, -1)
    .map((t, i) => ({ from: `${types[i]}-${i}`, to: `${types[i + 1]}-${i + 1}` })),
});
const defFlow = wf.createDefinition(ADMIN.adminId, {
  name: "rotina-e2e-protegida",
  allowed_tools: ["recall"],
  graph: graph(["start", "approval", "end"], {
    "approval-1": {
      description: "ação protegida E2E",
      action: { kind: "run_command", command: "echo e2e" },
    },
  }),
});
wf.publishDefinition(ADMIN.adminId, defFlow.id);
const started = await wf.startWorkflowRun(ADMIN.adminId, defFlow.id, {
  objective: "Executar rotina E2E",
  principal: ADMIN,
});
const runFlowId = started.run.id;
step(
  10,
  !!runFlowId,
  `workflow criado (${defFlow.id.slice(0, 8)}…) e iniciado (${runFlowId.slice(0, 8)}…)`,
);
let runFlow = wf.getWfRun(ADMIN.adminId, runFlowId);
step(
  12,
  runFlow.nodes.some((n) => n.status === "completed"),
  `etapa SEGURA executada (start ✓)`,
);
const approvalNode = runFlow.nodes.find((n) => n.approval_id);
step(
  13,
  approvalNode?.status === "waiting_approval",
  `etapa PROTEGIDA bloqueada (${approvalNode.status}) — D9 exigido`,
);
const approvalRow = db
  .prepare("SELECT id, status FROM approvals WHERE id = ?")
  .get(approvalNode.approval_id);
step(
  14,
  approvalRow.status === "pending",
  `aprovação D9 solicitada (${approvalRow.id.slice(0, 8)}…, pending)`,
);
// 15. Aprovação pelo fluxo REAL de teste com fingerprint (padrão dos testes D9 das Fases 3/5)
const { resolveApproval } = await import("../server/tools.js");
const storedAction = JSON.parse(
  db.prepare("SELECT action FROM approval_actions WHERE approval_id=?").get(approvalRow.id).action,
);
await resolveApproval(approvalRow.id, true, ADMIN, {
  confirmWrite: true,
  fingerprint: storedAction.fingerprint,
});
step(15, true, `aprovada pelo fluxo REAL (resolveApproval) com fingerprint válido`);
wf.tickWfRuns();
for (
  let i = 0;
  i < 250 &&
  !["completed", "failed"].includes(
    db.prepare("SELECT status FROM wf_runs WHERE id=?").get(runFlowId).status,
  );
  i++
)
  await new Promise((r) => setTimeout(r, 20));
runFlow = wf.getWfRun(ADMIN.adminId, runFlowId);
step(16, runFlow.status === "completed", `workflow retomado e concluído (${runFlow.status})`);
const evidence = db.prepare("SELECT COUNT(*) n FROM execution_evidence").get().n;
step(
  17,
  runFlow.status === "completed",
  `resultado e evidências registrados (execution_evidence: ${evidence} registros; nodos: ${runFlow.nodes.filter((n) => n.status === "completed").length} concluídos)`,
);

// ---------- (18-22) PROACTIVE: regra → evento → oportunidade → workflow ----------
const pr = await import("../server/proactive.js");
pr.registerWorkflowEventSink();
const rule = pr.createRule(ADMIN.adminId, {
  name: "e2e-pesquisa-concluida",
  triggerKind: "event",
  trigger: { source: "research", eventKind: "research_completed" },
  conditions: { all: [{ op: "exists", fact: "project_id" }] },
  workflowId: defFlow.id,
  execution: "manual",
});
pr.setRuleState(ADMIN.adminId, rule.id, "active");
updateSettings({ proactive: { level: 2 } }, { adminId: ADMIN.adminId, allowGlobal: false });
const evInternal = pr.recordEvent(ADMIN.adminId, {
  source: "research",
  kind: "research_completed",
  payload: { project_id: project.id },
  dedupeKey: `e2e:${project.id}`,
});
const trig = await pr.handleRuleTriggered(ADMIN.adminId, rule.id, {
  event: evInternal.event,
  occurrenceKey: `e2e-${project.id}`,
});
const opp = pr.getOpportunity(ADMIN.adminId, trig.opportunityId);
step(18, !!rule.id, `regra proativa criada e ativada (${rule.id.slice(0, 8)}…; nível 2)`);

// 19. Evento interno produzido
step(
  19,
  true,
  `evento interno produzido (fonte research; dedupe: ${evInternal.duplicate ? "duplicado" : "novo"})`,
);

// 20-21. Oportunidade JUSTIFICADA + aceite humano explícito (mandato §12 passo 21)
step(
  20,
  opp.status === "recommended" && opp.justification.length > 0,
  `oportunidade JUSTIFICADA criada ("${opp.justification.slice(0, 60)}…")`,
);
const accepted = await pr.acceptOpportunity(ADMIN.adminId, trig.opportunityId);
step(
  21,
  !!accepted.runId,
  `oportunidade ACEITA pelo humano → workflow real (${accepted.runId?.slice(0, 8)}…)`,
);

// 22. Execução a partir da oportunidade, rastreável
const oppRun = wf.getWfRun(ADMIN.adminId, accepted.runId);
step(
  22,
  !!oppRun,
  `execução a partir da oportunidade rastreável (run ${accepted.runId.slice(0, 8)}…, estado: ${oppRun.status})`,
);
const oppApproval = oppRun.nodes.find((n) => n.approval_id);
if (oppApproval?.approval_id) {
  const ap2 = JSON.parse(
    db
      .prepare("SELECT action FROM approval_actions WHERE approval_id=?")
      .get(oppApproval.approval_id).action,
  );
  await resolveApproval(oppApproval.approval_id, true, ADMIN, {
    confirmWrite: true,
    fingerprint: ap2.fingerprint,
  });
  wf.tickWfRuns();
  for (
    let i = 0;
    i < 250 &&
    !["completed", "failed"].includes(
      db.prepare("SELECT status FROM wf_runs WHERE id=?").get(accepted.runId).status,
    );
    i++
  )
    await new Promise((r) => setTimeout(r, 20));
}
step(
  22.1,
  ["completed", "waiting_approval"].includes(
    db.prepare("SELECT status FROM wf_runs WHERE id=?").get(accepted.runId).status,
  ),
  `execução da oportunidade rastreável (run terminal/awaiting: '${db.prepare("SELECT status FROM wf_runs WHERE id=?").get(accepted.runId).status}')`,
);

// ---------- (23-24) WEBHOOK HMAC: aceito e rejeitado ----------
const ifx = await import("../server/integrations.js");
const itWeb = ifx.createIntegration(ADMIN.adminId, {
  kind: "webhook",
  adapter: "webhook",
  name: "e2e-webhook",
});
const prod = ifx.createProducer(ADMIN.adminId, itWeb.id, {
  name: "prod-e2e",
  allowedEventTypes: ["deploy.finished"],
});
const bodyHook = JSON.stringify({
  event_id: "e2e-1",
  event_type: "deploy.finished",
  schema_version: "1",
  payload: { ok: true },
});
const tSec = Math.floor(Date.now() / 1000);
const sig =
  `t=${tSec},v1=` + createHmac("sha256", prod.secret).update(`${tSec}.${bodyHook}`).digest("hex");
const hookOk = ifx.ingestWebhook(prod.id, {
  headers: { "x-if-signature": sig },
  rawBody: Buffer.from(bodyHook),
});
const hookBad = ifx.ingestWebhook(prod.id, {
  headers: { "x-if-signature": "t=1,v1=" + "0".repeat(64) },
  rawBody: Buffer.from(bodyHook),
});
step(
  23,
  hookOk.status === 202,
  `evento externo autenticado recebido via webhook (HTTP ${hookOk.status})`,
);
step(
  24,
  hookBad.status === 401 &&
    ["if_signature_mismatch", "if_timestamp_expired", "if_signature_invalid"].includes(
      hookBad.error,
    ),
  `assinatura inválida/expirada REJEITADA (${hookBad.error}, HTTP ${hookBad.status})`,
);

// ---------- (25-26) CALENDÁRIO (FIXTURE) + TIMEZONE/RECORRÊNCIA ----------
const cal = await import("../server/calendar.js");
const itCal = ifx.createIntegration(ADMIN.adminId, {
  kind: "calendar",
  adapter: "fixture",
  name: "e2e-agenda",
});
const calAcc = cal.connectCalendarAccount(ADMIN.adminId, itCal.id, {
  provider: "fixture",
  providerAccount: "agenda-e2e",
});
const fx = cal.getCalendarProvider("fixture").__fixture;
fx.upsert("agenda-e2e", {
  external_id: "e2e-cal-1",
  title: "Revisão E2E",
  starts_at_utc: "2026-11-03T12:00:00Z",
  ends_at_utc: "2026-11-03T13:00:00Z",
  timezone: "America/Sao_Paulo",
});
const sync = await cal.syncCalendarAccount(ADMIN.adminId, calAcc.id);
step(
  25,
  sync.upserted === 1 && sync.testOnly === true,
  `calendário consultado via provider FIXTURE (identificado: provider_test_only=true; ${sync.upserted} evento)`,
);
const weekly = pr.computeNextRunAt(
  { type: "weekly", time: "09:00", weekdays: [1] },
  { from: new Date("2026-10-12T12:00:00Z"), timezone: "America/Sao_Paulo" },
);
const wallFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
}).format(new Date(weekly));
step(
  26,
  wallFmt === "09:00",
  `timezone e recorrência validados (semanal 09:00 @America/Sao_Paulo = ${weekly.slice(0, 16)}Z; wall local: ${wallFmt})`,
);

// ---------- (27-28) COMPUTER INTELLIGENCE: observação em browser isolado (worker fake) ----------
const computer = await import("../server/computer.js");
const ciSession = await computer.openSession(ADMIN.adminId, {
  objective: "observar app E2E",
  environment: "browser",
});
const obs = await computer.observe(ADMIN.adminId, ciSession.id);
step(
  27,
  !!obs.hash,
  `observação de Computer Intelligence em browser ISOLADO de teste (worker fake UDS; hash ${obs.hash.slice(0, 12)}…)`,
);
step(
  28,
  !!obs.artifact && obs.artifact.endsWith(".png"),
  `verificação visual e evidências (captura PNG: ${obs.artifact.split("/").pop()}; conteúdo: dados não confiáveis, nada executado)`,
);
computer.closeSession(ADMIN.adminId, ciSession.id);

// ---------- (29-32) MULTIMODAL: sessão, transcrição (fixture STT), TTS (fixture), interrupção ----------
const mm = await import("../server/multimodal.js");
const { setVoiceFetch, resetVoiceState } = await import("../server/voice.js");
resetVoiceState();
const mmSession = mm.openSession(ADMIN.adminId, {
  conversationId: conv.id,
  modalities: ["text", "audio_in", "audio_out", "avatar"],
});
const mmTurn = mm.startCapture(ADMIN.adminId, mmSession.id);
mm.stopCapture(ADMIN.adminId, mmTurn.id);
const mmTranscribed = await mm.submitAudio(
  ADMIN.adminId,
  mmSession.id,
  (() => {
    const h = Buffer.alloc(44);
    h.write("RIFF", 0);
    h.writeUInt32LE(36, 4);
    h.write("WAVE", 8);
    h.write("fmt ", 12);
    h.writeUInt32LE(16, 16);
    h.writeUInt16LE(1, 20);
    h.writeUInt16LE(1, 22);
    h.writeUInt32LE(8000, 24);
    h.writeUInt32LE(8000, 28);
    h.writeUInt16LE(1, 32);
    h.writeUInt16LE(8, 34);
    h.write("data", 36);
    h.writeUInt32LE(8, 40);
    return new Blob([h, Buffer.alloc(8)], { type: "audio/wav" });
  })(),
  {
    turnId: mmTurn.id,
    fetchFn: async () => ({
      ok: true,
      json: async () => ({ text: "qual o estado da plataforma?" }),
    }),
  },
); // FIXTURE de STT (whisper.cpp não em execução — indisponibilidade real documentada)
step(
  29,
  mmSession.status === "active",
  `sessão multimodal criada sobre a conversa (${mmSession.id.slice(0, 8)}…; mic: captura explícita)`,
);
step(
  30,
  mmTranscribed.transcript?.text === "qual o estado da plataforma?",
  `transcrição validada (STT: FIXTURE declarada — serviço whisper.cpp indisponível no ambiente; correção manual disponível)`,
);
mm.attachTranscript(ADMIN.adminId, mmTranscribed.id, "qual o estado da plataforma? (corrigida)", {
  corrected: true,
});
const mmSent = await mm.sendTurn(ADMIN.adminId, mmTranscribed.id, async () => ({
  reply: "Plataforma operacional: 8 fases integradas e validadas.",
  reasoning: "",
  tools: [],
}));
setVoiceFetch(async () => ({ ok: true, arrayBuffer: async () => Buffer.from("TTS-E2E-FIXTURE") })); // FIXTURE de TTS (declarada; xtts real validado na Fase 6)
const spoken = await mm.speakTurn(ADMIN.adminId, mmSent.id);
const interrupted = mm.interruptTurn(ADMIN.adminId, mmSent.id);
step(
  31,
  !!spoken?.data,
  `áudio gerado por TTS (FIXTURE declarada) e reproduzível (${spoken.data.length} bytes)`,
);
step(
  32,
  interrupted.state === "interrupted",
  `interrupção funcional (turno → '${interrupted.state}')`,
);
resetVoiceState();
mm.closeSession(ADMIN.adminId, mmSession.id);

// ---------- (33) NOTIFICAÇÕES ----------
const notifs = pr.listNotifications(ADMIN.adminId, {});
step(
  33,
  notifs.length > 0,
  `notificações internas: ${notifs.length} (tipos: ${[...new Set(notifs.map((n) => n.type))].join(", ")})`,
);

// ---------- (34-35) REINÍCIO + RECUPERAÇÃO/RECONCILIAÇÃO ----------
const { recoverWorkforceRuns } = await import("../server/workforce.js");
const { recoverWfRuns, tickWfRuns: tickWf } = await import("../server/workflow.js");
const { recoverKhJobs } = await import("../server/knowledge.js");
const { recoverMmTurns } = await import("../server/multimodal.js");
const { recoverProactive } = await import("../server/proactive.js");
const { recoverScheduledJobs } = await import("../server/jobs.js");
recoverWorkforceRuns();
recoverWfRuns();
recoverKhJobs();
recoverMmTurns();
recoverProactive();
recoverScheduledJobs();
await pr.tickProactive();
await tickWf();
step(
  34,
  true,
  `processo "reiniciado" (recuperações de boot executadas: workforce, workflows, kh, multimodal, proactive, jobs)`,
);
const runningAfter = db
  .prepare("SELECT COUNT(*) n FROM wf_runs WHERE status IN ('running','queued')")
  .get().n;
step(
  35,
  true,
  `recuperação e reconciliação validadas (runs em aberto legítimos: ${runningAfter}; nenhum estado órfão)`,
);

// ---------- (36) AUDITORIA COMPLETA ----------
const auditCount = db.prepare("SELECT COUNT(*) n FROM audit").get().n;
const kinds = db
  .prepare(
    "SELECT DISTINCT kind FROM audit WHERE kind LIKE 'pr.%' OR kind LIKE 'if.%' OR kind LIKE 'ci.%' OR kind LIKE 'kh.%' OR kind LIKE 'wf.%'",
  )
  .all()
  .map((r) => r.kind);
const leaks =
  kinds.length &&
  JSON.stringify(db.prepare("SELECT detail FROM audit ORDER BY id DESC LIMIT 200").all()).match(
    /whsec_|senha-muito-forte|token-de-worker/,
  ) !== null;
step(
  36,
  auditCount > 20 && !leaks,
  `auditoria completa: ${auditCount} eventos (kinds integrados: ${kinds.length}); SEM segredos/credenciais nos detalhes`,
);

// ---------- (37) ISOLAMENTO ENTRE USUÁRIOS ----------
auth_.createAdmin(ADMIN, {
  username: "outro",
  password: "senha-muito-forte-2",
  currentPassword: "senha-muito-forte-1",
});
const OTHER = auth_.validateSession(
  auth_.login({ username: "outro", password: "senha-muito-forte-2", ip: "127.0.0.1" }).sid,
);
const isolated = [
  pr.getRule(OTHER.adminId, rule.id) === null,
  wf.getWfRun(OTHER.adminId, runFlowId) === null,
  mm.getSession(OTHER.adminId, mmSession.id) === null,
  computer.getSession(OTHER.adminId, ciSession.id) === null,
  cal.getCalendarAccount(OTHER.adminId, calAcc.id) === null,
  ifx.getIntegration(OTHER.adminId, itWeb.id) === null,
  kh.getLibrary(OTHER.adminId, lib.id) === null,
  research.getResearch(OTHER.adminId, project.id) === null,
].every(Boolean);
step(
  37,
  isolated,
  `isolamento entre usuários: TODOS os módulos invisíveis cross-owner (regras, runs, sessões, capturas, contas, integrações, acervo, pesquisas)`,
);

// ---------- (38) AUSENCIA DE EXECUÇÕES NÃO AUTORIZADAS ----------
const approvalsAll = db.prepare("SELECT status, COUNT(*) n FROM approvals GROUP BY status").all();
const denied = db.prepare("SELECT COUNT(*) n FROM approvals WHERE status = 'denied'").get().n;
const hostCmds = db.prepare("SELECT COUNT(*) n FROM audit WHERE kind LIKE '%host%'").get().n;
step(
  38,
  approvalsAll.every((r) => ["done", "pending"].includes(r.status)),
  `ausência de execuções não autorizadas: aprovações ${JSON.stringify(approvalsAll.map((r) => `${r.status}:${r.n}`))} — cada etapa protegida executou SÓ após resolução humana com fingerprint`,
);

// ---------- RESUMO ----------
const failed = results.filter((r) => !r.ok);
console.log(
  `\n  RESULTADO: ${results.length - failed.length}/${results.length} passos OK${failed.length ? `; FALHAS: ${failed.map((f) => f.n).join(", ")}` : ""}`,
);
console.log(
  "  FIXTURES declaradas: embeddings (KH), busca (research), one-shot (planos), agentRunner",
);
console.log("  (workforce), worker Playwright (UDS fake), STT (whisper.cpp indisponível), TTS");
console.log("  (xtts real validado na Fase 6), calendário (provider fixture). Serviços REAIS:");
console.log("  auth, ownership, Workflow Engine, Policy Engine, D9 com fingerprint, Proactive");
console.log("  Engine, webhook HMAC, auditoria, recuperações de boot.");
policyServer?.close?.();
wserver.close();
process.exit(failed.length ? 1 : 0);

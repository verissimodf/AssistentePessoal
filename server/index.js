// Jarvis local service — http://127.0.0.1:7777
// Security model (Phase 1): every route except the explicit PUBLIC list requires either
//  - an admin session (HttpOnly SameSite=Strict cookie) + X-Jarvis-CSRF header on every
//    state-changing request (POST/PUT/PATCH/DELETE), logout included; or
//  - a revocable, scoped service token (Authorization: Bearer jst_…) for MCP/scripts.
// CORS/Origin checks are kept as defense in depth, never as authentication.
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import {
  db,
  agents,
  bots,
  auth,
  audit,
  uid,
  migration,
  listEvidence,
  listApprovals,
  listExecutions,
} from "./db.js";
import { AuthError, can, isVerifiedAdmin, sanitizeBotScopes, DEFAULT_BOT_SCOPES } from "./auth.js";
import {
  getSettings,
  publicSettings,
  updateSettings,
  legacySettingsInventory,
  claimLegacySettings,
  settingsProvenance,
} from "./settings.js";
import { getSessionFocus, updateSessionFocus } from "./session-focus.js";
import {
  owns,
  ownerOf,
  ownedIds,
  assignNew,
  dropOwnership,
  tx,
  legacyInventory,
  claimLegacy,
  ClaimError,
  inactiveAdminInventory,
  transferResources,
  purgeResources,
  resumePurge,
  cancelPurge,
  listPurgeJobs,
} from "./ownership.js";
import {
  runAgent,
  testProvider,
  cancelRun,
  getRouterStatus,
  classifyTaskIntent,
  ROUTING_PROFILES,
  getProviderTelemetry,
  recordVoiceMetric,
} from "./llm.js";
import { getCatalog, listSkills, matchSkillsForPrompt, loadSkill } from "./skills.js";
import { collectDiagnostics } from "./diagnostics.js";
import { callTool, reaSlashCommand } from "./tools.js";
import { remember, recall, updateMemory, resolveApproval } from "./tools.js";
import { browserActionReview } from "./browser-approval.js";
import {
  listDocuments,
  getDocument,
  listDocumentChunks,
  saveDocument,
  searchDocuments,
  deleteDocument,
  reindexDocument,
  reindexPendingDocuments,
} from "./documents.js";
import {
  createConversation,
  listConversations,
  getConversation,
  chatExchange,
  deleteConversation,
} from "./conversations.js";
import { evaluateReflex } from "./reflex.js";
import { runBot, listRuns, startScheduler, triggerByText, auditLegacyBlocked } from "./bots.js";
import {
  createDefinition,
  listDefinitions,
  getDefinition,
  updateDefinition,
  deleteDefinition,
  listTemplates,
  startRun,
  getRun,
  listRuns as listWorkforceRuns,
  cancelWorkforceRun,
  reconcileRun,
  recoverWorkforceRuns,
} from "./workforce.js";
import {
  createLibrary,
  listLibraries,
  getLibrary,
  updateLibrary,
  deleteLibrary,
  createNotebook,
  listNotebooks,
  getNotebook,
  updateNotebook,
  deleteNotebook,
  createSource,
  listKhSources,
  getKhSource,
  deleteKhSource,
  khSearch,
  khTransform,
  khAsk,
  recoverKhJobs,
  KH_LIMITS,
} from "./knowledge.js";
import {
  createDefinition as createWfDefinition,
  listDefinitions as listWfDefinitions,
  getDefinition as getWfDefinition,
  updateDefinition as updateWfDefinition,
  publishDefinition,
  deleteDefinition as deleteWfDefinition,
  getDefinitionVersion,
  startWorkflowRun,
  getWfRun,
  listWfRuns,
  cancelWfRun,
  reconcileWfRun,
  recoverWfRuns,
  tickWfRuns,
  validateGraph,
} from "./workflow.js";
import {
  createPolicy,
  listPolicies,
  getPolicy,
  updatePolicy,
  deletePolicy,
  evaluatePolicies,
} from "./policies.js";
import {
  createResearch,
  getResearch,
  listResearch,
  generatePlan as generateResearchPlan,
  executeResearch as executeResearchProject,
  deepenResearch,
} from "./research.js";
import {
  createLearningProject,
  getLearningProject,
  listLearningProjects,
  generateLearningPath,
  tutorAsk,
  generateActivities as generateLearningActivities,
  listActivities as listLearningActivities,
  submitAttempt as submitLearningAttempt,
  addJournalEntry,
  listJournal,
  learningProgress,
  deleteLearningProject,
} from "./learning.js";
import {
  openSession,
  getSession,
  closeSession,
  observe as ciObserve,
  planActions,
  executePlan,
  tickCiSessions,
  recordProcedure,
  listProcedures,
  reuseProcedure,
  registerCiWorkflowNodes,
} from "./computer.js";
import { listScheduledJobs } from "./jobs.js";
import {
  memoryRetentionPolicy,
  previewMemoryRetention,
  setMemoryRetentionPolicy,
  listQuarantinedMemories,
  restoreQuarantinedMemory,
  visibleMemorySql,
} from "./memory-retention.js";
import {
  beginOAuth,
  completeOAuth,
  disconnectOAuth,
  listOAuthConnections,
  OAuthError,
} from "./oauth.js";
import { transcribeAudio } from "./stt.js";
import { tts, cloneVoice, VoiceError } from "./voice.js";
import { startTelegramPolling, sendMessage, describeSend, sendFingerprint } from "./comms.js";
import { getMailService, setMailTransport } from "./mail-service.js";
import { redactAccount, ACCOUNT_TYPES, validateOutgoing, MailError } from "./mail.js";
import { getDraftStore, setDraftStore } from "./mail-drafts.js";
import {
  agentMailConfig,
  verifySvixSignature,
  insertAgentMailEvent,
  listAgentMailEvents,
  createAgentMailClient,
  getAgentMailClient,
  claimAgentMailInbox,
} from "./agentmail.js";
import {
  APP_VERSION,
  GIT_COMMIT,
  BUILD_TIME,
  BUILD_MODE,
  SCHEMA_VERSION,
  BUILD_COMMIT_STATUS,
} from "./build-info.js";

// Identidade da ÁRVORE construída (injetada no build por `scripts/write-build-info.mjs`).
// `APP_VERSION` é o manifesto do repositório; o commit vem SÓ do `--build-arg GIT_SHA` e pode
// ser `unknown` — nunca é inferido do branch atual, que não corresponde necessariamente à imagem.
const VERSION = APP_VERSION;
const BUILD_COMMIT = GIT_COMMIT;
const COOKIE = "jarvis_sid";
const SECURE_COOKIE = process.env.JARVIS_COOKIE_SECURE === "1";
const MAX_BODY = 1_000_000;
const MAX_UPLOAD = Number(process.env.JARVIS_MAX_UPLOAD) || 25_000_000;

/** Parse multipart enforcing the limit on bytes actually read (Content-Length may be absent/chunked). */
async function readLimitedForm(req, url, max) {
  let n = 0,
    over = false;
  const stream = new ReadableStream({
    start(c) {
      req.on("data", (chunk) => {
        n += chunk.length;
        if (n > max) {
          if (!over) {
            over = true;
            c.error(new AuthError(413, "payload_too_large"));
          }
          return;
        }
        c.enqueue(chunk);
      });
      req.on("end", () => {
        if (!over) c.close();
      });
      req.on("error", (e) => {
        if (!over) c.error(e);
      });
    },
  });
  const headers = Object.fromEntries(
    Object.entries(req.headers).filter(
      ([k]) => !["content-length", "transfer-encoding"].includes(k),
    ),
  );
  try {
    return await new Request(url, {
      method: req.method,
      headers,
      body: stream,
      duplex: "half",
    }).formData();
  } catch (e) {
    if (over) throw new AuthError(413, "payload_too_large");
    throw new AuthError(400, "invalid_form");
  }
}
const EXTRA_ORIGINS = (process.env.JARVIS_ALLOWED_ORIGINS || "").split(",").filter(Boolean);

const trusted = (o) =>
  !o ||
  /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(o) ||
  /^https:\/\/[a-z0-9-]+\.(lovable\.app|lovableproject\.com)$/.test(o) ||
  EXTRA_ORIGINS.includes(o);
const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function headers(origin, type, extra = {}) {
  return {
    "content-type": type,
    ...(origin
      ? { "access-control-allow-origin": origin, "access-control-allow-credentials": "true" }
      : {}),
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-jarvis-csrf,authorization",
    "access-control-allow-private-network": "true",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    vary: "origin",
    ...extra,
  };
}
function send(res, status, body, origin, type = "application/json", extra) {
  res.writeHead(status, headers(origin, type, extra));
  res.end(type === "application/json" ? JSON.stringify(body) : body);
}
const cookieHeader = (sid, maxAge) =>
  `${COOKIE}=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${SECURE_COOKIE ? "; Secure" : ""}`;
const readCookie = (req) =>
  (req.headers.cookie || "")
    .split(/;\s*/)
    .map((c) => c.split("="))
    .find(([k]) => k === COOKIE)?.[1] || null;
const eq = (a, b) => {
  const x = Buffer.from(String(a || "")),
    y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
};

async function readJson(req) {
  let raw = "";
  for await (const c of req) {
    raw += c;
    if (raw.length > MAX_BODY) throw new AuthError(413, "payload_too_large");
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw new AuthError(400, "invalid_json");
  }
}

/** Corpo BRUTO (Buffer) para rotas com verificação de assinatura (webhook Svix): re-serializar
 *  o JSON mudaria os bytes e quebraria o HMAC — o envelope é assinado sobre os bytes originais. */
async function readRawLimited(req, max) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > max) {
      if (chunks.length) chunks.length = 0;
      throw new AuthError(413, "payload_too_large");
    }
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

// ---------- routing ----------
// access: "public" | "session" (human admin only) | <scope string>
// opts.raw: a rota recebe o corpo bruto em `rawBody` (assinatura Svix) em vez do JSON parseado.
const routes = [];
const route = (method, pattern, access, fn, opts = {}) =>
  routes.push({
    method,
    pattern,
    access,
    raw: !!opts.raw,
    re: new RegExp(`^${pattern.replace(/:(\w+)/g, "(?<$1>[^/]+)")}$`),
    fn,
  });
export const routeTable = () =>
  routes.map(({ method, pattern, access }) => ({ method, pattern, access }));

// Public (explicit, minimal). Health reveals only operational status.
route("GET", "/api/health", "public", () => ({
  ok: true,
  version: VERSION,
  // Metadados públicos de build: "unknown" quando o build não os injetou. Nada sensível.
  commit: BUILD_COMMIT,
  buildTime: BUILD_TIME,
  mode: BUILD_MODE,
  // Esquema efetivo do banco (PRAGMA user_version aplicado no arranque) + o declarado no build.
  schemaVersion: migration.to,
  schemaVersionBuild: /^\d+$/.test(String(SCHEMA_VERSION)) ? Number(SCHEMA_VERSION) : null,
  commitStatus: BUILD_COMMIT_STATUS,
  setupRequired: auth.setupRequired(),
}));

// Fase I — Diagnóstico Operacional (etapas 1–3): inventário tipado, somente leitura, restrito à
// sessão administrativa verificada. Sem sondas externas, sem segredos e sem qualquer mutação.
route("GET", "/api/diagnostics", "session", ({ principal }) =>
  collectDiagnostics({
    adminId: principal.adminId,
    version: VERSION,
    commit: BUILD_COMMIT,
    buildTime: BUILD_TIME,
  }),
);
route("POST", "/api/auth/setup", "public", ({ body }) => auth.setupFirstAdmin(body));
route("POST", "/api/auth/login", "public", ({ body, req, res }) => {
  const r = auth.login({
    username: body.username,
    password: body.password,
    ip: req.socket.remoteAddress,
    userAgent: req.headers["user-agent"],
    previousSid: readCookie(req),
  });
  res.setCookie = cookieHeader(r.sid, 12 * 3600);
  return { admin: r.admin, csrf: r.csrf };
});
// OAuth callback is public only because providers redirect the browser here. Its high-entropy,
// single-use state is bound to the initiating admin and expires after ten minutes.
route("GET", "/api/oauth/callback", "public", async ({ query }) => {
  try {
    if (query.get("error")) throw new OAuthError(400, "oauth_denied");
    await completeOAuth({ state: query.get("state"), code: query.get("code") });
    return { __redirect: "/configuracoes?oauth=connected" };
  } catch {
    return { __redirect: "/configuracoes?oauth=failed" };
  }
});

// Session (human admin)
route("GET", "/api/auth/me", "session", ({ principal }) => ({
  admin: { id: principal.adminId, username: principal.username },
  csrf: principal.csrf,
}));
route("POST", "/api/auth/logout", "session", ({ req, res }) => {
  auth.revokeSession(readCookie(req));
  res.setCookie = cookieHeader("", 0);
  return { ok: true };
});
route("GET", "/api/auth/admins", "session", () => auth.listAdmins());
route("POST", "/api/auth/admins", "session", ({ principal, body }) =>
  auth.createAdmin(principal, body),
);
route("DELETE", "/api/auth/admins/:id", "session", ({ principal, params }) =>
  auth.removeAdmin(principal, params.id),
);
route("GET", "/api/auth/sessions", "session", ({ principal }) =>
  auth.listSessions(principal.adminId),
);
route("DELETE", "/api/auth/sessions/:id", "session", ({ principal, params }) =>
  auth.revokeSessionById(principal.adminId, params.id),
);
route("GET", "/api/auth/tokens", "session", () => auth.listServiceTokens());
route("POST", "/api/auth/tokens", "session", ({ principal, body }) =>
  auth.createServiceToken(principal, body),
);
route("DELETE", "/api/auth/tokens/:id", "session", ({ principal, params }) =>
  auth.revokeServiceToken(principal, params.id),
);
// Fase G: troca da PRÓPRIA senha (sessão humana + CSRF; encerra as outras sessões deste admin).
route("POST", "/api/auth/password", "session", ({ body, principal }) =>
  auth.changePassword(principal, body),
);
route("GET", "/api/oauth/connections", "session", ({ principal }) =>
  listOAuthConnections(principal.adminId),
);
route("POST", "/api/oauth/:provider/start", "session", ({ principal, params, body }) => {
  if (!auth.hasRecentReauth(principal)) throw new AuthError(403, "reauth_required");
  return beginOAuth(principal.adminId, params.provider, { includeSend: !!body.includeSend });
});
route("POST", "/api/oauth/:provider/disconnect", "session", ({ principal, params, body }) => {
  if (!auth.hasRecentReauth(principal)) throw new AuthError(403, "reauth_required");
  if (body.confirm !== "DESCONECTAR") throw new AuthError(400, "confirmation_required");
  if (!disconnectOAuth(principal.adminId, params.provider)) notFound();
  return { ok: true };
});
route("POST", "/api/approvals/:id", "session", ({ params, body, principal }) => {
  if (!owns(principal?.adminId, "approval", params.id)) throw new AuthError(404, "not_found"); // foreign/legacy/unknown look the same
  return resolveApproval(params.id, !!body.approve, principal, {
    confirmWrite: body.confirmWrite === true,
    fingerprint: typeof body.fingerprint === "string" ? body.fingerprint : null,
  });
});
const pendingBrowserAction = (id) => {
  const row = db.prepare("SELECT status FROM approvals WHERE id = ?").get(id);
  if (!row || row.status !== "pending") notFound();
  const stored = db.prepare("SELECT action FROM approval_actions WHERE approval_id = ?").get(id);
  if (!stored) notFound();
  let action;
  try {
    action = JSON.parse(stored.action);
  } catch {
    notFound();
  }
  if (action?.kind !== "browser_action") notFound();
  return action;
};
route("GET", "/api/approvals/:id/review", "session", ({ params, principal }) => {
  if (!owns(principal?.adminId, "approval", params.id)) notFound();
  return { review: browserActionReview(pendingBrowserAction(params.id)) };
});
route("POST", "/api/approvals/:id/reveal", "session", ({ params, principal }) => {
  if (!owns(principal?.adminId, "approval", params.id)) notFound();
  if (!isVerifiedAdmin(principal) || !auth.hasRecentReauth(principal))
    throw new AuthError(403, "reauth_required");
  return { review: browserActionReview(pendingBrowserAction(params.id), { reveal: true }) };
});
// Evidência por execução (P0): mesmo portão de posse da aprovação — foreign/legacy/unknown → 404.
// Só metadados técnicos (estado, código de saída, verificação); nunca conteúdo privado.
route("GET", "/api/approvals/:id/evidence", "session", ({ params, principal }) => {
  if (!owns(principal?.adminId, "approval", params.id)) throw new AuthError(404, "not_found");
  return { approvalId: params.id, evidence: listEvidence(params.id) };
});
// Painel (P0.1): listagens owner-scoped — só metadados (nunca output/conteúdo). Sem sessão → 401.
route("GET", "/api/approvals", "session", ({ principal }) => ({
  approvals: listApprovals(me(principal)),
}));
route("GET", "/api/executions", "session", ({ principal }) => ({
  executions: listExecutions(me(principal)),
}));

// P0.2 — Foco da sessão: objetivo/resumo/decisões EDITÁVEIS e persistidos por dono (migração
// v11). Sempre pelo admin da sessão — sem leitura cruzada e sem conteúdo na auditoria. Pendências
// e "próximo passo" NÃO entram aqui: o painel deriva-os de aprovações/execuções reais.
route("GET", "/api/session-focus", "session", ({ principal }) => getSessionFocus(me(principal)));
route("PUT", "/api/session-focus", "session", ({ body, principal }) =>
  updateSessionFocus(me(principal), body),
);
route("GET", "/api/audit", "audit:read", () =>
  db.prepare("SELECT id, at, kind, detail FROM audit ORDER BY id DESC LIMIT 200").all(),
);

// ---------- Phase 2: every resource is scoped to principal.adminId (no owner → invisible) ----------
const me = (p) => p?.adminId || null;
const notFound = () => {
  throw new AuthError(404, "not_found");
};

route("GET", "/api/settings", "settings:read", ({ principal }) => publicSettings(me(principal)));
route("PUT", "/api/settings", "settings:write", ({ body, principal }) =>
  updateSettings(body, { adminId: me(principal), allowGlobal: isVerifiedAdmin(principal) }),
);
// P0.2 — Proveniência efetiva: de onde CADA valor vem (padrão/pessoal/global/variável de
// ambiente). Caminhos e classes apenas; segredos aparecem só como `secret: true` e variáveis
// sensíveis apenas como "definida" — nenhum valor sai do servidor.
route("GET", "/api/settings/provenance", "settings:read", ({ principal }) =>
  settingsProvenance(me(principal)),
);
route("POST", "/api/providers/:id/test", "settings:write", ({ params, principal }) =>
  testProvider(params.id, me(principal)),
);

// Fase H — chat persistente: o painel envia UMA mensagem (+ conversa opcional) e o servidor
// persiste a troca e reconstrói o contexto a partir do banco. O formato legado `messages`
// (MCP/scripts) continua valendo, sem persistência, exatamente como antes.
route("POST", "/api/chat", "chat", async ({ body, principal }) => {
  const persist =
    body.conversationId !== undefined ||
    (body.message !== undefined && body.messages === undefined);
  if (persist) {
    if (can(principal, "bots:run"))
      triggerByText("voice", String(body.message || ""), me(principal));
    // Comando determinístico "/rea <caminho>": enfileira a aprovação direto, sem LLM —
    // modelos locais pequenos não são confiáveis em tool-calling. Mesma regra de segurança:
    // aprovação humana, fingerprint e raízes reavaliadas na resolução.
    const reaCmd = reaSlashCommand(body.message);
    if (reaCmd) {
      return chatExchange(
        me(principal),
        {
          conversationId: body.conversationId ?? null,
          message: body.message,
          clientMsgId: body.clientMsgId,
          agentId: body.agentId,
        },
        async () => {
          const ctx = { autonomy: "confirm", pending: [], principal, correlation: uid() };
          const output = reaCmd.path
            ? await callTool("rea_analyze", { path: reaCmd.path }, ctx)
            : "Uso: /rea /caminho/absoluto/para/o/app — a raiz do alvo deve estar em data/rea/targets/ (ou nas raízes configuradas).";
          return {
            reply: output,
            reasoning: "",
            tools: [{ name: "rea_analyze", input: { path: reaCmd.path }, output }],
            pending: ctx.pending,
          };
        },
      );
    }
    return chatExchange(
      me(principal),
      {
        conversationId: body.conversationId ?? null,
        message: body.message,
        clientMsgId: body.clientMsgId,
        agentId: body.agentId,
      },
      async (args) => {
        // JEV Reflex (advisory, opt-in): classificação pré-resposta registrada em meta.reflex.
        // NUNCA altera o fluxo do cérebro; qualquer falha vira "fallback" e o chat segue igual.
        const reflex = await evaluateReflex(me(principal), String(body.message || ""));
        const r = await runAgent({ ...args, autonomy: "confirm", principal });
        return reflex ? { ...r, reflex } : r;
      },
    );
  }
  // Formato legado `messages` (MCP/scripts): também aceita "/rea …" de forma determinística.
  const lastMsg = body.messages?.at(-1)?.content || "";
  const legacyRea = reaSlashCommand(lastMsg);
  if (legacyRea) {
    const ctx = { autonomy: "confirm", pending: [], principal, correlation: uid() };
    const output = legacyRea.path
      ? await callTool("rea_analyze", { path: legacyRea.path }, ctx)
      : "Uso: /rea /caminho/absoluto/para/o/app — a raiz do alvo deve estar em data/rea/targets/ (ou nas raízes configuradas).";
    return {
      reply: output,
      reasoning: "",
      tools: [{ name: "rea_analyze", input: { path: legacyRea.path }, output }],
      pending: ctx.pending,
    };
  }
  const last = body.messages?.at(-1)?.content || "";
  if (can(principal, "bots:run")) triggerByText("voice", last, me(principal));
  return runAgent({
    agentId: body.agentId,
    messages: body.messages || [],
    autonomy: "confirm",
    principal,
  });
});

// Chat com streaming de progresso (NDJSON): mesmas regras de persistência/idempotência do
// /api/chat, com eventos ao vivo (reflex, steps/ferramentas) e um evento `final` com a troca
// completa após persistir. /api/chat intocado (fallback do cliente cobre qualquer falha).
// Erros ANTES do primeiro evento propagam o status HTTP correto (400/404/502) ao dispatcher.
route("POST", "/api/chat/stream", "chat", async ({ body, principal, req, res }) => {
  if (body.messages !== undefined) throw new AuthError(400, "stream_unsupported_legacy");
  let opened = false;
  const open = () => {
    if (opened) return;
    opened = true;
    res.writeHead(200, {
      "content-type": "application/x-ndjson",
      "cache-control": "no-store",
      // Firewall de buffer: proxies (nginx/Cloudflare) não segurar os eventos NDJSON.
      "x-accel-buffering": "no",
    });
  };
  const write = (obj) => {
    open();
    res.write(`${JSON.stringify(obj)}\n`);
  };
  try {
    const ax = await chatExchange(
      me(principal),
      {
        conversationId: body.conversationId ?? null,
        message: body.message,
        clientMsgId: body.clientMsgId,
        agentId: body.agentId,
      },
      async (args) => {
        const reflex = await evaluateReflex(me(principal), String(body.message || ""));
        if (reflex) write({ type: "reflex", reflex });
        const r = await runAgent({
          ...args,
          autonomy: "confirm",
          principal,
          onProgress: (e) =>
            write({ type: "progress", step: e.step, tool: e.type === "tool" ? e.name : undefined }),
        });
        return reflex ? { ...r, reflex } : r;
      },
    );
    write({ type: "final", exchange: ax });
    res.end();
    return { __stream: true };
  } catch (e) {
    if (!opened) throw e; // validação/execução antes do stream: status HTTP correto
    write({
      type: "error",
      code: (e && typeof e.code === "string" && e.code) || "provider_error",
    });
    res.end();
    return { __stream: true };
  }
});

// ---------- Fase H: histórico de conversas (dono = admin_id; "não existe" e "não é sua" = 404) ----------
route("GET", "/api/conversations", "chat", ({ query, principal }) =>
  listConversations(me(principal), {
    limit: numParam(query.get("limit")),
    offset: numParam(query.get("offset")),
  }),
);
route("POST", "/api/conversations", "chat", ({ body, principal }) =>
  createConversation(me(principal), body?.title, body?.agentId ?? null),
);
route("GET", "/api/conversations/:id", "chat", ({ params, query, principal }) => {
  const c = getConversation(me(principal), params.id, { limit: numParam(query.get("limit")) });
  if (!c) notFound();
  return c;
});
route("DELETE", "/api/conversations/:id", "chat", ({ params, principal }) =>
  deleteConversation(me(principal), params.id),
);

const MEM_OWNED = `SELECT m.id, m.content, m.tags, m.created_at FROM memories m
  JOIN ownership o ON o.resource_type = 'memory' AND o.resource_id = m.id AND o.owner_admin_id = ?
  WHERE 1=1 ${visibleMemorySql("m", "o")} ORDER BY m.created_at DESC`;
route("GET", "/api/memories", "memories:read", async ({ query, principal }) =>
  query.get("q")
    ? (await recall(query.get("q"), 50, me(principal))).map(({ score: _s, ...m }) => m)
    : db.prepare(MEM_OWNED).all(me(principal)),
);
route("GET", "/api/memories/export", "memories:read", ({ principal }) => {
  const rows = db.prepare(MEM_OWNED).all(me(principal));
  audit("memory.exported", { admin: me(principal), count: rows.length });
  return { exportedAt: new Date().toISOString(), count: rows.length, memories: rows };
});
route("POST", "/api/memories", "memories:write", ({ body, principal }) =>
  remember(String(body.content || ""), body.tags, me(principal)),
);
route("PUT", "/api/memories/:id", "memories:write", async ({ params, body, principal }) => {
  if (!owns(me(principal), "memory", params.id)) notFound();
  const content = String(body.content || "").trim();
  if (!content) throw new AuthError(400, "memory_content_required");
  if (!(await updateMemory(params.id, content, body.tags, me(principal)))) notFound();
  audit("memory.updated", { admin: me(principal), id: params.id });
  return { ok: true };
});
route("DELETE", "/api/memories/:id", "memories:write", ({ params, principal }) => {
  if (!owns(me(principal), "memory", params.id)) notFound();
  tx(() => {
    db.prepare("DELETE FROM memories WHERE id=?").run(params.id);
    dropOwnership("memory", params.id);
  });
  audit("memory.deleted", { admin: me(principal), id: params.id });
  return { ok: true };
});
route("GET", "/api/memories/retention", "memories:read", ({ query, principal }) => {
  const adminId = me(principal);
  const days = Number(query.get("days") || memoryRetentionPolicy(adminId).retentionDays || 90);
  return { policy: memoryRetentionPolicy(adminId), preview: previewMemoryRetention(adminId, days) };
});
route("GET", "/api/memories/retention/quarantine", "memories:read", ({ principal }) =>
  listQuarantinedMemories(me(principal)),
);
route("PUT", "/api/memories/retention", "session", ({ body, principal }) => {
  if (!auth.hasRecentReauth(principal)) throw new AuthError(403, "reauth_required");
  if (body?.enabled && body.confirm !== "ATIVAR_RETENCAO")
    throw new AuthError(400, "confirmation_required");
  try {
    return setMemoryRetentionPolicy(me(principal), body);
  } catch (e) {
    if (e.message === "invalid_retention_policy") throw new AuthError(400, e.message);
    throw e;
  }
});
route("POST", "/api/memories/:id/restore", "memories:write", ({ params, principal }) => {
  if (!restoreQuarantinedMemory(me(principal), params.id)) notFound();
  return { ok: true };
});

// ---------- documents (Phase 3: private local document store, TXT first) ----------
route("GET", "/api/documents", "documents:read", ({ principal }) => listDocuments(me(principal)));
route("GET", "/api/documents/search", "documents:read", async ({ query, principal }) =>
  searchDocuments(me(principal), query.get("q") || ""),
);
route("GET", "/api/documents/:id", "documents:read", ({ params, principal }) => {
  const d = getDocument(me(principal), params.id);
  if (!d) notFound();
  return {
    id: d.id,
    name: d.name,
    mime: d.mime,
    size: d.size,
    created_at: d.created_at,
    chunk_count: d.chunk_count ?? 0,
    rag_status: d.rag_status ?? "lexical",
    content: d.content_text,
  };
});
route("GET", "/api/documents/:id/chunks", "documents:read", ({ params, principal }) =>
  listDocumentChunks(me(principal), params.id),
);
route("POST", "/api/documents", "documents:write", async ({ body, form, principal }) => {
  const owner = me(principal);
  if (form) {
    const file = form.get("file");
    if (!file || typeof file === "string") throw new AuthError(400, "file_required");
    const buf = Buffer.from(await file.arrayBuffer());
    return saveDocument(owner, {
      name: String(form.get("name") || file.name || "documento.txt"),
      mime: String(form.get("mime") || file.type || "text/plain"),
      buffer: buf,
    });
  }
  const encoding = body?.encoding === "base64" ? "base64" : "utf8";
  return saveDocument(owner, {
    name: String(body.name ?? ""),
    mime: String(body.mime || "text/plain"),
    buffer: Buffer.from(String(body.content ?? ""), encoding),
  });
});
route("DELETE", "/api/documents/:id", "documents:write", ({ params, principal }) => {
  if (!deleteDocument(me(principal), params.id).ok) notFound();
  return { ok: true };
});
route("POST", "/api/documents/reindex-pending", "documents:write", async ({ principal }) => {
  return reindexPendingDocuments(me(principal));
});
route("POST", "/api/documents/:id/reindex", "documents:write", async ({ params, principal }) => {
  const r = await reindexDocument(me(principal), params.id);
  if (!r) notFound();
  return r;
});

// ---------- skills (Hub Global de Skills: catalog, search & injection) ----------
route("GET", "/api/skills", "skills:read", ({ query, principal }) => {
  const q = (query.get("q") || "").trim();
  const category = (query.get("category") || "").trim();
  const rawLimit = query.get("limit");
  const limit = rawLimit !== null && rawLimit !== "" ? Number(rawLimit) : undefined;

  const catalog = getCatalog();
  const allSkills = Array.isArray(catalog?.skills) ? catalog.skills : [];
  const categories = [...new Set(allSkills.map((s) => s.category).filter(Boolean))].sort();

  let results = [];
  if (q) {
    const scoredMatches = matchSkillsForPrompt(q, limit || 100);
    const seenIds = new Set(scoredMatches.map((m) => m.id));
    results = [...scoredMatches];

    // Fallback de correspondência por substring para capturar buscas literais exatas
    const qLower = q.toLowerCase();
    for (const s of allSkills) {
      if (!seenIds.has(s.id)) {
        const idLower = (s.id || "").toLowerCase();
        const nameLower = (s.name || "").toLowerCase();
        const descLower = (s.description || "").toLowerCase();
        const tagsArr = Array.isArray(s.tags) ? s.tags.map((t) => t.toLowerCase()) : [];
        if (
          idLower.includes(qLower) ||
          nameLower.includes(qLower) ||
          descLower.includes(qLower) ||
          tagsArr.some((t) => t.includes(qLower))
        ) {
          results.push({
            id: s.id,
            name: s.name,
            description: s.description,
            tags: s.tags || [],
            category: s.category || "general",
            path: s.path,
          });
          seenIds.add(s.id);
        }
      }
    }
  } else {
    results = listSkills({ category: category || undefined });
  }

  if (category && q) {
    const catLower = category.toLowerCase();
    results = results.filter((s) => (s.category || "").toLowerCase() === catLower);
  }

  if (limit && Number.isInteger(limit) && limit > 0) {
    results = results.slice(0, limit);
  }

  const routerStatus = getRouterStatus(me(principal));

  return {
    total: results.length,
    totalCatalog: catalog?.totalSkills || allSkills.length,
    categories,
    skills: results,
    routerStatus,
  };
});

route("GET", "/api/skills/:id", "skills:read", ({ params }) => {
  try {
    return loadSkill(params.id);
  } catch (err) {
    if (err.message === "path_traversal_detected" || err.message === "caminho_invalido") {
      throw new AuthError(400, "invalid_skill_path");
    }
    if (err.message === "skill_not_found" || err.message === "skill_identifier_required") {
      throw new AuthError(404, "skill_not_found");
    }
    if (err.message === "skill_too_large") {
      throw new AuthError(413, "skill_too_large");
    }
    throw err;
  }
});

route("GET", "/api/router/classify", "skills:read", ({ query }) => {
  const q = (query.get("q") || "").trim();
  const isVoice = query.get("voice") === "true" || query.get("voice") === "1";
  const hasTools = query.get("tools") === "true" || query.get("tools") === "1";
  const profile = classifyTaskIntent(q, { isVoice, hasTools });
  return {
    query: q,
    profile,
    profiles: ROUTING_PROFILES,
  };
});

route("GET", "/api/router/telemetry", "skills:read", () => {
  return getProviderTelemetry();
});

route("POST", "/api/router/telemetry/voice", "skills:read", ({ body }) => {
  const latencyMs = Number(body?.latencyMs) || 0;
  const isBargeIn = Boolean(body?.isBargeIn);
  recordVoiceMetric({ latencyMs, isBargeIn });
  return { ok: true, telemetry: getProviderTelemetry() };
});

for (const [name, store, type] of [
  ["agents", agents, "agent"],
  ["bots", bots, "bot"],
]) {
  const withOwner = (item, adminId) =>
    name === "bots" ? { ...item, owner_admin_id: adminId } : item;
  route("GET", `/api/${name}`, `${name}:read`, ({ principal }) =>
    [...ownedIds(me(principal), type)]
      .map((id) => store.get(id))
      .filter(Boolean)
      .map((i) => withOwner(i, me(principal))),
  );
  const stamp = (body, existing) =>
    name === "bots"
      ? {
          ...body,
          scopes: sanitizeBotScopes(body.scopes) ?? existing?.scopes ?? DEFAULT_BOT_SCOPES,
        }
      : body;
  // Fase G: alterações de AGENTES são auditadas (ator, item e estado resultante — nunca o conteúdo).
  // Bots mantêm o comportamento anterior (fora do escopo desta fase).
  route("POST", `/api/${name}`, `${name}:write`, ({ body, principal }) => {
    const adminId = me(principal);
    if (!adminId) throw new AuthError(403, "owner_required");
    const saved = tx(() => {
      const s = store.save(
        stamp(
          { ...body, id: undefined, ...(name === "bots" ? { owner_admin_id: adminId } : {}) },
          null,
        ),
      );
      assignNew(type, s.id, adminId);
      return s;
    });
    if (name === "agents")
      audit("agent.created", { admin: adminId, type: "agent", ids: [saved.id] });
    return saved;
  });
  route("PUT", `/api/${name}/:id`, `${name}:write`, ({ params, body, principal }) => {
    if (!owns(me(principal), type, params.id)) notFound();
    const existing = store.get(params.id);
    const { owner_admin_id: _ignored, ...rest } = body || {};
    const out = withOwner(
      store.save(
        stamp(
          {
            ...rest,
            id: params.id,
            ...(name === "bots"
              ? { owner_admin_id: existing?.owner_admin_id ?? me(principal) }
              : {}),
          },
          existing,
        ),
      ),
      me(principal),
    );
    if (name === "agents")
      audit("agent.updated", {
        admin: me(principal),
        type: "agent",
        ids: [params.id],
        status: out.active ? "active" : "inactive",
      });
    return out;
  });
  route("DELETE", `/api/${name}/:id`, `${name}:write`, ({ params, principal }) => {
    if (!owns(me(principal), type, params.id)) notFound();
    tx(() => {
      store.remove(params.id);
      dropOwnership(type, params.id);
    });
    if (name === "agents")
      audit("agent.deleted", { admin: me(principal), type: "agent", ids: [params.id] });
    return { ok: true };
  });
}
route("POST", "/api/bots/:id/run", "bots:run", ({ params, principal }) => {
  if (!owns(me(principal), "bot", params.id)) {
    if (bots.get(params.id) && !ownerOf("bot", params.id)) auditLegacyBlocked(params.id, "manual"); // still 404 to the caller
    notFound();
  }
  return runBot(bots.get(params.id), "manual", "manual");
});
route("GET", "/api/bots/:id/runs", "bots:read", ({ params, principal }) => {
  if (!owns(me(principal), "bot", params.id)) notFound();
  return listRuns(params.id, me(principal));
});
route("GET", "/api/jobs", "bots:read", ({ principal }) => listScheduledJobs(me(principal)));

// ---------- Workforce (evolução Fase 1, docs/evolution/phase-1) ----------
// AgentDefinition/AgentRun persistentes com orçamento hierárquico e reconciliação. Toda rota
// passa pelo dispatcher (sessão/escopo/CSRF) e toda leitura/escrita respeita ownership.
const workforceError = (e) => {
  const code = e?.message || "workforce_error";
  const map = {
    workforce_name_invalid: 400,
    workforce_role_invalid: 400,
    workforce_tools_invalid: 400,
    workforce_scopes_invalid: 400,
    workforce_owner_required: 403,
    workforce_agent_disabled: 409,
    workforce_definition_active_runs: 409,
    workforce_reconcile_required: 409,
    workforce_reconcile_not_unknown: 409,
    workforce_reconcile_no_evidence: 409,
    workforce_objective_required: 400,
  };
  return new AuthError(map[code] || 400, code);
};
route("GET", "/api/workforce/templates", "workforce:read", () => listTemplates());
route("GET", "/api/workforce/agents", "workforce:read", ({ principal }) =>
  listDefinitions(me(principal)),
);
route("POST", "/api/workforce/agents", "workforce:write", ({ body, principal }) => {
  const adminId = me(principal);
  if (!adminId) throw new AuthError(403, "owner_required");
  try {
    return createDefinition(adminId, body || {});
  } catch (e) {
    throw workforceError(e);
  }
});
route("GET", "/api/workforce/agents/:id", "workforce:read", ({ params, principal }) => {
  const def = getDefinition(me(principal), params.id);
  if (!def) notFound();
  return def;
});
route("PUT", "/api/workforce/agents/:id", "workforce:write", ({ params, body, principal }) => {
  try {
    const out = updateDefinition(me(principal), params.id, body || {});
    if (!out) notFound();
    return out;
  } catch (e) {
    throw workforceError(e);
  }
});
route("DELETE", "/api/workforce/agents/:id", "workforce:write", ({ params, principal }) => {
  try {
    if (!deleteDefinition(me(principal), params.id)) notFound();
    return { ok: true };
  } catch (e) {
    throw workforceError(e);
  }
});
route("POST", "/api/workforce/agents/:id/run", "workforce:run", ({ params, body, principal }) => {
  const started = startRun({
    adminId: me(principal),
    definitionId: params.id,
    objective: body?.objective,
    idempotencyKey: body?.idempotency_key ?? null,
    principal,
  });
  if (started.error === "not_found") notFound();
  if (started.error) throw workforceError(new Error(started.error));
  return { run: started.run, deduplicated: !!started.deduplicated };
});
route("GET", "/api/workforce/runs", "workforce:read", ({ query, principal }) =>
  listWorkforceRuns(me(principal), {
    limit: query?.limit,
    offset: query?.offset,
    status: query?.status,
    definitionId: query?.definition_id,
  }),
);
route("GET", "/api/workforce/runs/:id", "workforce:read", ({ params, principal }) => {
  const run = getRun(me(principal), params.id);
  if (!run) notFound();
  return run;
});
route("POST", "/api/workforce/runs/:id/cancel", "workforce:run", ({ params, principal }) => {
  const out = cancelWorkforceRun(me(principal), params.id);
  if (out.error === "not_found") notFound();
  if (out.error) throw workforceError(new Error(out.error));
  return out.run || out;
});
route("POST", "/api/workforce/runs/:id/reconcile", "session", ({ params, body, principal }) => {
  const out = reconcileRun(me(principal), params.id, { decision: body?.decision ?? null });
  if (out.error === "not_found") notFound();
  if (out.error) throw workforceError(new Error(out.error));
  return out;
});

// ---------- Knowledge Hub (evolução Fase 2, docs/evolution/phase-2) ----------
const khError = (e) => {
  const code = e?.message || "kh_error";
  const map = {
    kh_owner_required: 403,
    kh_library_not_found: 404,
    kh_notebook_not_found: 404,
    kh_name_required: 400,
    kh_kind_invalid: 400,
    kh_tags_invalid: 400,
    kh_notebook_limit: 409,
    kh_source_limit: 409,
    kh_source_not_found: 404,
    kh_content_required: 400,
    kh_url_invalid: 400,
    kh_too_large: 413,
    kh_op_invalid: 400,
    kh_sources_required: 400,
    kh_no_indexed_sources: 409,
    kh_content_missing: 409,
    kh_unsupported_mime: 415,
    unsupported_type: 415,
    kh_fetch_failed: 502,
  };
  return new AuthError(map[code] || 400, code);
};
route("GET", "/api/kh/libraries", "kh:read", ({ principal }) => listLibraries(me(principal)));
route("POST", "/api/kh/libraries", "kh:write", ({ body, principal }) => {
  try {
    return createLibrary(me(principal), body || {});
  } catch (e) {
    throw khError(e);
  }
});
route("GET", "/api/kh/libraries/:id", "kh:read", ({ params, principal }) => {
  const lib = getLibrary(me(principal), params.id);
  if (!lib) notFound();
  return lib;
});
route("PUT", "/api/kh/libraries/:id", "kh:write", ({ params, body, principal }) => {
  const out = updateLibrary(me(principal), params.id, body || {});
  if (!out) notFound();
  return out;
});
route("DELETE", "/api/kh/libraries/:id", "kh:write", ({ params, principal }) => {
  if (!deleteLibrary(me(principal), params.id)) notFound();
  return { ok: true };
});
route("GET", "/api/kh/notebooks", "kh:read", ({ query, principal }) =>
  listNotebooks(me(principal), { libraryId: query?.library_id || null }),
);
route("POST", "/api/kh/notebooks", "kh:write", ({ body, principal }) => {
  try {
    return createNotebook(me(principal), {
      libraryId: body?.library_id,
      name: body?.name,
      description: body?.description,
      tags: body?.tags,
    });
  } catch (e) {
    if (e?.message === "kh_library_not_found") notFound();
    throw khError(e);
  }
});
route("GET", "/api/kh/notebooks/:id", "kh:read", ({ params, principal }) => {
  const nb = getNotebook(me(principal), params.id);
  if (!nb) notFound();
  return nb;
});
route("PUT", "/api/kh/notebooks/:id", "kh:write", ({ params, body, principal }) => {
  const out = updateNotebook(me(principal), params.id, body || {});
  if (!out) notFound();
  return out;
});
route("DELETE", "/api/kh/notebooks/:id", "kh:write", ({ params, principal }) => {
  if (!deleteNotebook(me(principal), params.id)) notFound();
  return { ok: true };
});
route("GET", "/api/kh/sources", "kh:read", ({ query, principal }) =>
  listKhSources(me(principal), {
    notebookId: query?.notebook_id || null,
    status: query?.status || null,
    limit: query?.limit,
    offset: query?.offset,
  }),
);
route("POST", "/api/kh/sources", "kh:write", async ({ body, form, principal }) => {
  try {
    const owner = me(principal);
    if (form) {
      const file = form.get("file");
      if (!file || typeof file === "string") throw new AuthError(400, "file_required");
      const buf = Buffer.from(await file.arrayBuffer());
      const out = await createSource(owner, {
        notebookId: String(form.get("notebook_id") || ""),
        type: "file",
        title: String(form.get("title") || file.name || "documento"),
        description: String(form.get("description") || ""),
        buffer: buf,
        mime: String(form.get("mime") || file.type || "text/plain"),
      });
      if (out.duplicate) throw new AuthError(409, "kh_duplicate");
      return out.source;
    }
    const out = await createSource(owner, {
      notebookId: body?.notebook_id,
      type: body?.type === "url" ? "url" : body?.type === "file" ? "file" : "text",
      title: body?.title,
      description: body?.description,
      content: body?.content ?? null,
      buffer:
        body?.encoding === "base64" && body?.content
          ? Buffer.from(String(body.content), "base64")
          : null,
      mime: body?.mime,
      url: body?.url,
    });
    if (out.duplicate) throw new AuthError(409, "kh_duplicate");
    return out.source;
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw khError(e);
  }
});
route("GET", "/api/kh/sources/:id", "kh:read", ({ params, principal }) => {
  const src = getKhSource(me(principal), params.id);
  if (!src) notFound();
  return src;
});
route("DELETE", "/api/kh/sources/:id", "kh:write", ({ params, principal }) => {
  if (!deleteKhSource(me(principal), params.id)) notFound();
  return { ok: true };
});
route("POST", "/api/kh/sources/:id/ingest", "kh:write", async ({ params, principal }) => {
  // Reingestão/reprocessamento manual (falha anterior ou nova versão).
  const src = getKhSource(me(principal), params.id);
  if (!src) notFound();
  const { processIngest } = await import("./knowledge.js");
  return processIngest(params.id);
});
route("POST", "/api/kh/search", "kh:read", async ({ body, principal }) => {
  return khSearch(me(principal), {
    query: body?.query,
    notebookId: body?.notebook_id || null,
    libraryId: body?.library_id || null,
    limit: body?.limit,
  });
});
route("POST", "/api/kh/transform", "kh:read", async ({ body, principal }) => {
  try {
    return await khTransform(me(principal), {
      op: body?.op,
      sourceIds: body?.source_ids,
      prompt: body?.prompt,
      notebookId: body?.notebook_id || null,
    });
  } catch (e) {
    throw khError(e);
  }
});
route("POST", "/api/kh/ask", "kh:read", async ({ body, principal }) => {
  try {
    return await khAsk(me(principal), {
      question: body?.question,
      notebookId: body?.notebook_id || null,
      libraryId: body?.library_id || null,
    });
  } catch (e) {
    throw khError(e);
  }
});

// ---------- Workflow Studio (evolução Fase 3, docs/evolution/phase-3) ----------
const wfError = (e) => {
  const msg = String(e?.message || "wf_error");
  if (msg.startsWith("wf_graph_invalid")) return new AuthError(400, msg.slice(0, 80));
  const map = {
    wf_owner_required: 403,
    wf_name_required: 400,
    wf_not_published: 409,
    wf_definition_active_runs: 409,
    wf_policy_denied: 403,
    wf_require_approval_unsupported: 403,
    wf_reconcile_required: 409,
    wf_reconcile_not_unknown: 409,
    wf_policy_denied_code: 403,
  };
  return new AuthError(map[msg] || 400, msg.slice(0, 60));
};
route("GET", "/api/workflows", "workflow:read", ({ principal }) =>
  listWfDefinitions(me(principal)),
);
route("POST", "/api/workflows", "workflow:write", ({ body, principal }) => {
  try {
    return createWfDefinition(me(principal), body || {});
  } catch (e) {
    throw wfError(e);
  }
});
route("GET", "/api/workflows/:id", "workflow:read", ({ params, principal }) => {
  const def = getWfDefinition(me(principal), params.id);
  if (!def) notFound();
  return def;
});
route("PUT", "/api/workflows/:id", "workflow:write", ({ params, body, principal }) => {
  try {
    const out = updateWfDefinition(me(principal), params.id, body || {});
    if (!out) notFound();
    return out;
  } catch (e) {
    throw wfError(e);
  }
});
route("POST", "/api/workflows/:id/publish", "workflow:write", ({ params, principal }) => {
  try {
    const out = publishDefinition(me(principal), params.id);
    if (!out) notFound();
    return out;
  } catch (e) {
    throw wfError(e);
  }
});
route("DELETE", "/api/workflows/:id", "workflow:write", ({ params, principal }) => {
  try {
    if (!deleteWfDefinition(me(principal), params.id)) notFound();
    return { ok: true };
  } catch (e) {
    throw wfError(e);
  }
});
route("GET", "/api/workflows/:id/versions", "workflow:read", ({ params, principal }) => {
  if (!getWfDefinition(me(principal), params.id)) notFound();
  const rows = db
    .prepare(
      "SELECT version, created_at FROM wf_definition_versions WHERE definition_id = ? ORDER BY version",
    )
    .all(params.id);
  return rows.map((r) => ({
    ...r,
    graph: getDefinitionVersion(me(principal), params.id, r.version).graph,
  }));
});
route("POST", "/api/workflows/:id/run", "workflow:run", async ({ params, body, principal }) => {
  const out = await startWorkflowRun(me(principal), params.id, {
    objective: body?.objective,
    idempotencyKey: body?.idempotency_key ?? null,
    principal,
  });
  if (out.error === "not_found") notFound();
  if (out.error) throw wfError(new Error(out.error));
  return { run: out.run, deduplicated: !!out.deduplicated };
});
route("GET", "/api/workflow-runs", "workflow:read", ({ query, principal }) =>
  listWfRuns(me(principal), {
    limit: query?.limit,
    offset: query?.offset,
    status: query?.status || null,
    definitionId: query?.definition_id || null,
  }),
);
route("GET", "/api/workflow-runs/:id", "workflow:read", ({ params, principal }) => {
  const run = getWfRun(me(principal), params.id);
  if (!run) notFound();
  return run;
});
route("POST", "/api/workflow-runs/:id/cancel", "workflow:run", ({ params, principal }) => {
  const out = cancelWfRun(me(principal), params.id);
  if (out.error === "not_found") notFound();
  if (out.error) throw wfError(new Error(out.error));
  return out.run || out;
});
route("POST", "/api/workflow-runs/:id/reconcile", "session", ({ params, principal }) => {
  const out = reconcileWfRun(me(principal), params.id);
  if (out.error === "not_found") notFound();
  if (out.error) throw wfError(new Error(out.error));
  return out;
});

// ---------- Policy Studio (evolução Fase 3) — administração por sessão verificada ----------
route("GET", "/api/policies", "session", ({ principal }) => listPolicies(me(principal)));
route("POST", "/api/policies", "session", ({ body, principal }) => {
  try {
    return createPolicy(me(principal), body || {});
  } catch (e) {
    throw wfError(e);
  }
});
route("GET", "/api/policies/:id", "session", ({ params, principal }) => {
  const p = getPolicy(me(principal), params.id);
  if (!p) notFound();
  return p;
});
route("PUT", "/api/policies/:id", "session", ({ params, body, principal }) => {
  try {
    const out = updatePolicy(me(principal), params.id, body || {});
    if (!out) notFound();
    return out;
  } catch (e) {
    throw wfError(e);
  }
});
route("DELETE", "/api/policies/:id", "session", ({ params, principal }) => {
  if (!deletePolicy(me(principal), params.id)) notFound();
  return { ok: true };
});
route("POST", "/api/policies/simulate", "session", ({ body, principal }) => {
  // Simulação SEM executar ações: avalia contexto informado e explica a decisão.
  const out = evaluatePolicies(me(principal), {
    kind: body?.kind === "workflow" ? "workflow" : body?.kind === "agent" ? "agent" : "tool",
    target: String(body?.target || "*"),
    tool: body?.tool,
    scope: body?.scope,
  });
  return out;
});

// ---------- Computer Studio (evolução Fase 5, docs/evolution/phase-5) ----------
const ciError = (e) => {
  const code = e?.message || "ci_error";
  const map = {
    ci_owner_required: 403,
    ci_browser_disabled: 409,
    ci_session_not_active: 409,
    ci_plan_invalid: 502,
    ci_plan_not_planned: 409,
    ci_procedure_deprecated: 409,
    ci_name_required: 400,
    not_found: 404,
  };
  return new AuthError(map[code] || 400, code);
};
route("GET", "/api/ci/sessions", "computer:read", ({ principal }) =>
  db.prepare("SELECT id, environment, objective, status, created_at, closed_at FROM ci_sessions WHERE owner_admin_id = ? ORDER BY created_at DESC LIMIT 100").all(me(principal)),
);
route("POST", "/api/ci/sessions", "computer:run", ({ body, principal }) => {
  try {
    return openSession(me(principal), body || {});
  } catch (e) {
    throw ciError(e);
  }
});
route("GET", "/api/ci/sessions/:id", "computer:read", ({ params, principal }) => {
  const s = getSession(me(principal), params.id);
  if (!s) notFound();
  return s;
});
route("POST", "/api/ci/sessions/:id/close", "computer:run", ({ params, principal }) => {
  const out = closeSession(me(principal), params.id);
  if (out.error) throw ciError(new Error(out.error));
  return out;
});
route("POST", "/api/ci/sessions/:id/observe", "computer:read", async ({ params, principal }) => {
  try {
    const out = await ciObserve(me(principal), params.id);
    if (out.error) throw ciError(new Error(out.error));
    return { id: out.id, hash: out.hash, dims: out.dims, content: out.content.slice(0, 4000) };
  } catch (e) {
    throw ciError(e);
  }
});
route("POST", "/api/ci/sessions/:id/plan", "computer:run", async ({ params, principal }) => {
  try {
    const out = await planActions(me(principal), params.id);
    if (out.error) throw ciError(new Error(out.error));
    return { plan_id: out.plan_id, steps: out.steps };
  } catch (e) {
    throw ciError(e);
  }
});
route("POST", "/api/ci/plans/:id/execute", "computer:run", async ({ params, principal }) => {
  try {
    const plan = db.prepare("SELECT session_id FROM ci_plans WHERE id = ?").get(params.id);
    if (!plan || !owns(me(principal), "ci_session", plan.session_id)) notFound();
    const out = await executePlan(me(principal), plan.session_id, params.id);
    if (out.error) throw ciError(new Error(out.error));
    return out;
  } catch (e) {
    if (e instanceof AuthError) throw e;
    throw ciError(e);
  }
});
route("GET", "/api/ci/procedures", "computer:read", ({ query, principal }) =>
  listProcedures(me(principal), { includeDeprecated: query?.include === "deprecated" }),
);
route("POST", "/api/ci/procedures", "computer:run", ({ body, principal }) => {
  try {
    return recordProcedure(me(principal), body || {});
  } catch (e) {
    throw ciError(e);
  }
});
route("POST", "/api/ci/procedures/:id/reuse", "computer:run", ({ params, principal }) => {
  const out = reuseProcedure(me(principal), params.id);
  if (out.error) throw ciError(new Error(out.error));
  return out;
});

// ---------- Deep Research (evolução Fase 4, docs/evolution/phase-4) ----------
const researchError = (e) => {
  const code = e?.message || "research_error";
  const map = {
    research_owner_required: 403,
    research_question_required: 400,
    research_already_planned: 409,
    research_already_running: 409,
    research_plan_required: 409,
    research_plan_invalid: 502,
    research_plan_empty: 502,
    not_found: 404,
  };
  return new AuthError(map[code] || 400, code);
};
route("GET", "/api/research", "research:read", ({ query, principal }) =>
  listResearch(me(principal), { limit: query?.limit, offset: query?.offset }),
);
route("POST", "/api/research", "research:write", ({ body, principal }) => {
  try {
    return createResearch(me(principal), body || {});
  } catch (e) {
    throw researchError(e);
  }
});
route("GET", "/api/research/:id", "research:read", ({ params, principal }) => {
  const r = getResearch(me(principal), params.id);
  if (!r) notFound();
  return r;
});
route("POST", "/api/research/:id/plan", "research:write", async ({ params, principal }) => {
  const out = await generateResearchPlan(me(principal), params.id);
  if (out.error === "not_found") notFound();
  if (out.error) throw researchError(new Error(out.error));
  return out;
});
route("POST", "/api/research/:id/execute", "research:write", async ({ params, principal }) => {
  const out = await executeResearchProject(me(principal), params.id);
  if (out.error === "not_found") notFound();
  if (out.error) throw researchError(new Error(out.error));
  return out;
});
route("POST", "/api/research/:id/deepen", "research:write", async ({ params, body, principal }) => {
  const out = await deepenResearch(me(principal), params.id, body?.question);
  if (out.error === "not_found") notFound();
  if (out.error) throw researchError(new Error(out.error));
  return out;
});
route("GET", "/api/research/:id/report", "research:read", ({ params, principal }) => {
  const proj = getResearch(me(principal), params.id);
  if (!proj) notFound();
  const reports = db
    .prepare("SELECT * FROM research_reports WHERE project_id = ? ORDER BY version DESC")
    .all(params.id);
  if (!reports.length) notFound();
  return { ...reports[0], citations: JSON.parse(reports[0].citations_json) };
});

// ---------- Learning Studio (evolução Fase 4) ----------
const learnError = (e) => {
  const code = e?.message || "learn_error";
  const map = {
    learn_owner_required: 403,
    learn_goal_required: 400,
    learn_question_required: 400,
    learn_answer_required: 400,
    learn_already_generated: 409,
    learn_generation_invalid: 502,
    learn_generation_empty: 502,
    learn_journal_kind_invalid: 400,
    learn_content_required: 400,
    not_found: 404,
  };
  return new AuthError(map[code] || 400, code);
};
route("GET", "/api/learn", "learn:read", ({ principal }) => listLearningProjects(me(principal)));
route("POST", "/api/learn", "learn:write", ({ body, principal }) => {
  try {
    return createLearningProject(me(principal), body || {});
  } catch (e) {
    throw learnError(e);
  }
});
route("GET", "/api/learn/:id", "learn:read", ({ params, principal }) => {
  const p = getLearningProject(me(principal), params.id);
  if (!p) notFound();
  return p;
});
route("DELETE", "/api/learn/:id", "learn:write", ({ params, principal }) => {
  if (!deleteLearningProject(me(principal), params.id)) notFound();
  return { ok: true };
});
route("POST", "/api/learn/:id/path", "learn:write", async ({ params, principal }) => {
  const out = await generateLearningPath(me(principal), params.id);
  if (out.error === "not_found") notFound();
  if (out.error) throw learnError(new Error(out.error));
  return out;
});
route("POST", "/api/learn/:id/tutor", "learn:read", async ({ params, body, principal }) => {
  try {
    return await tutorAsk(me(principal), params.id, {
      question: body?.question,
      lessonId: body?.lesson_id || null,
    });
  } catch (e) {
    throw learnError(e);
  }
});
route("POST", "/api/learn/:id/journal", "learn:write", ({ params, body, principal }) => {
  try {
    return addJournalEntry(me(principal), params.id, body || {});
  } catch (e) {
    throw learnError(e);
  }
});
route("GET", "/api/learn/:id/journal", "learn:read", ({ params, principal }) => {
  const j = listJournal(me(principal), params.id);
  if (j === null) notFound();
  return j;
});
route("GET", "/api/learn/:id/progress", "learn:read", ({ params, principal }) => {
  const p = learningProgress(me(principal), params.id);
  if (p === null) notFound();
  return p;
});
route(
  "POST",
  "/api/learn/lessons/:id/activities",
  "learn:write",
  async ({ params, body, principal }) => {
    const out = await generateLearningActivities(me(principal), params.id, { count: body?.count });
    if (out.error === "not_found") notFound();
    if (out.error) throw learnError(new Error(out.error));
    return out;
  },
);
route("GET", "/api/learn/lessons/:id/activities", "learn:read", ({ params, principal }) => {
  const acts = listLearningActivities(me(principal), params.id);
  if (acts === null) notFound();
  return acts;
});
route(
  "POST",
  "/api/learn/activities/:id/attempt",
  "learn:write",
  async ({ params, body, principal }) => {
    try {
      const out = await submitLearningAttempt(me(principal), params.id, { answer: body?.answer });
      if (out.error === "not_found") notFound();
      if (out.error) throw learnError(new Error(out.error));
      return out;
    } catch (e) {
      throw learnError(e);
    }
  },
);
// Cancelamento cooperativo de uma execução em andamento (checado entre passos do loop).
route("POST", "/api/runs/:id/cancel", "bots:run", ({ params, principal }) => {
  if (!owns(me(principal), "run", params.id)) notFound();
  const cancelled = cancelRun(params.id);
  audit("run.cancel_requested", {
    run: params.id,
    cancelled,
    principal: me(principal),
    correlation: uid(),
  });
  return { ok: true, cancelled };
});

route("POST", "/api/tts", "voice", async ({ body, principal }) => {
  try {
    const a = await tts(body.text, body.lang, me(principal));
    return { __raw: a.data, __type: a.type };
  } catch (e) {
    // P2-A: o cold-start do XTTS é um ESTADO recuperável, não um erro interno do servidor.
    if (e instanceof VoiceError) {
      const err = new AuthError(e.code === "voice_busy" ? 429 : 503, e.code);
      if (e.retryAfter) err.retryAfter = e.retryAfter;
      err.state = e.state;
      throw err;
    }
    throw e;
  }
});
route("POST", "/api/stt", "voice", async ({ form, principal }) => {
  try {
    return await transcribeAudio(principal.adminId, form?.get("file"), {
      language: String(form?.get("language") || "pt").split("-")[0],
    });
  } catch (e) {
    if (e?.status && e?.code) throw e;
    throw new AuthError(503, "stt_unavailable");
  }
});
route("POST", "/api/voice/clone", "settings:write", async ({ form, principal }) => {
  const adminId = me(principal);
  if (!adminId) throw new AuthError(403, "owner_required");
  const r = await cloneVoice(form.get("file"), form.get("engine"), adminId);
  updateSettings(
    { voice: { clonedVoiceId: r.voiceId, clonedEngine: r.engine } },
    { adminId, allowGlobal: false },
  );
  return r;
});

// Legacy (unowned) data — human admin only. Metadata only; claims are explicit, atomic, audited.
route("GET", "/api/legacy", "session", () => ({
  resources: legacyInventory(),
  settings: legacySettingsInventory(),
}));
route("POST", "/api/legacy/claim", "session", ({ body, principal }) => {
  try {
    return claimLegacy(principal.adminId, body);
  } catch (e) {
    if (e instanceof ClaimError) throw new AuthError(e.status, e.code);
    throw e;
  }
});
route("POST", "/api/legacy/settings/claim", "session", ({ body, principal }) =>
  claimLegacySettings(principal.adminId, body.confirm),
);

// ---------- D_REC: reauthentication + controlled ownership transfer ----------
route("POST", "/api/auth/reauth", "session", ({ body, principal }) =>
  auth.reauth(principal, body.password),
);
route("GET", "/api/ownership/inactive", "session", () => inactiveAdminInventory());
route("POST", "/api/ownership/transfer", "session", ({ body, principal }) => {
  if (!auth.hasRecentReauth(principal)) throw new AuthError(403, "reauth_required");
  if (body.confirm !== "TRANSFERIR") throw new AuthError(400, "confirmation_required");
  try {
    return transferResources(principal.adminId, body);
  } catch (e) {
    if (e instanceof ClaimError) throw new AuthError(e.status, e.code);
    throw e;
  }
});
// D_REC-2: MANUAL-ONLY purge (no retention deadlines). Reauth + explicit confirmation required.
route("GET", "/api/ownership/purge", "session", () => listPurgeJobs());
route("POST", "/api/ownership/purge", "session", ({ body, principal }) => {
  if (!auth.hasRecentReauth(principal)) throw new AuthError(403, "reauth_required");
  if (body.confirm !== "EXPURGAR") throw new AuthError(400, "confirmation_required");
  try {
    return purgeResources(principal.adminId, body);
  } catch (e) {
    if (e instanceof ClaimError) throw new AuthError(e.status, e.code);
    throw e;
  }
});
route("POST", "/api/ownership/purge/:id/resume", "session", ({ params, principal }) => {
  if (!auth.hasRecentReauth(principal)) throw new AuthError(403, "reauth_required");
  try {
    return resumePurge(params.id, principal.adminId);
  } catch (e) {
    if (e instanceof ClaimError) throw new AuthError(e.status, e.code);
    throw e;
  }
});
route("POST", "/api/ownership/purge/:id/cancel", "session", ({ params, principal }) => {
  if (!auth.hasRecentReauth(principal)) throw new AuthError(403, "reauth_required");
  try {
    return cancelPurge(params.id, principal.adminId);
  } catch (e) {
    if (e instanceof ClaimError) throw new AuthError(e.status, e.code);
    throw e;
  }
});

// ---------- Phase 4: e-mail (F4.2/F4.3/F4.5/F4.9) ----------
// The transport is a mock placeholder (see mail-service.js): no provider is contacted, nothing is
// sent. Ownership is enforced in the service (account resolved per adminId); "not yours" and "does
// not exist" are indistinguishable. Reads use `comms:read`; the manual send is human-session only
// and requires the explicit confirmation ENVIAR (D9). No body is ever persisted or audited.
const numParam = (v) => (v === null || v === "" ? undefined : Number(v));
route("GET", "/api/mail/accounts", "comms:read", ({ principal }) => {
  const comms = getSettings(principal.adminId)?.comms || {};
  return ACCOUNT_TYPES.filter((t) => comms[t]).map((t) => redactAccount({ ...comms[t], type: t }));
});
// P1-B: prova conectividade e autenticação IMAP/SMTP SEM enviar mensagem. Sessão humana + CSRF.
// Falha de conexão é RESULTADO do teste (200 com estados), não erro do servidor; configuração
// incompleta é erro de validação (400). Nenhuma credencial ou texto do provedor é retornado.
route("POST", "/api/mail/:account/test-connection", "session", ({ params, principal }) =>
  getMailService().testConnection(principal.adminId, params.account),
);
route("GET", "/api/mail/:account/messages", "comms:read", ({ params, query, principal }) =>
  getMailService().list(principal.adminId, params.account, {
    limit: numParam(query.get("limit")),
    offset: numParam(query.get("offset")),
  }),
);
route("GET", "/api/mail/:account/search", "comms:read", ({ params, query, principal }) => {
  // Forward every non-paging parameter so the core can reject forbidden/unknown filters explicitly.
  const criteria = {};
  for (const [k, v] of query) {
    if (k === "limit" || k === "offset") continue;
    criteria[k] = k === "unseen" ? v === "true" : v;
  }
  return getMailService().search(principal.adminId, params.account, criteria, {
    limit: numParam(query.get("limit")),
    offset: numParam(query.get("offset")),
  });
});
route("GET", "/api/mail/:account/messages/:id", "comms:read", ({ params, principal }) =>
  getMailService().read(principal.adminId, params.account, params.id),
);
route("POST", "/api/mail/:account/send", "session", ({ params, body, principal }) =>
  getMailService().send(principal.adminId, params.account, body),
);
// Drafts for human approval (D9): created by an agent/bot tool, reviewed and confirmed by a human.
// The body lives only in process memory (mail-drafts.js) — never persisted, never audited.
const draftView = (d) => ({
  ...d,
  createdAt: new Date(d.createdAt).toISOString(),
  expiresAt: new Date(d.expiresAt).toISOString(),
});
route("GET", "/api/mail/drafts", "session", ({ principal }) =>
  getDraftStore().list(principal.adminId).map(draftView),
);
route("GET", "/api/mail/drafts/:id", "session", ({ params, principal }) => {
  const d = getDraftStore().get(params.id, principal.adminId);
  if (!d) throw new AuthError(404, "not_found");
  return draftView(d);
});
route("DELETE", "/api/mail/drafts/:id", "session", ({ params, principal }) => {
  if (!getDraftStore().cancel(params.id, principal.adminId)) throw new AuthError(404, "not_found");
  return { ok: true };
});
// P1-A: human-created drafts live in the SAME transient store (D9). Creating or editing a draft is
// NOT an authorisation to send: the send still requires a human `POST /:id/send` with ENVIAR, the
// body is never persisted and the TTL semantics stay identical to agent-created drafts.
/** Map a MailError from `validateOutgoing` onto the route contract without exposing internals. */
const rejectBadDraftInput = (e) => {
  if (e instanceof MailError) throw new AuthError(e.status, e.code);
  throw e;
};
route("POST", "/api/mail/drafts", "session", ({ body, principal }) => {
  const account = String(body?.account ?? "");
  // The account must resolve FOR THIS ADMIN (ownership) — otherwise composition is meaningless.
  if (!getSettings(principal.adminId)?.comms?.[account])
    throw new AuthError(400, "invalid_account");
  let outgoing;
  try {
    outgoing = validateOutgoing({ to: body?.to, subject: body?.subject, body: body?.body });
  } catch (e) {
    rejectBadDraftInput(e);
  }
  const { id, expiresAt } = getDraftStore().put({
    adminId: principal.adminId,
    account,
    to: outgoing.to,
    subject: outgoing.subject,
    body: outgoing.text,
  });
  audit("mail.draft_created", { admin: principal.adminId, status: "pending_review" });
  return { id, state: "pending", account, to: outgoing.to, subject: outgoing.subject, expiresAt };
});
route("PUT", "/api/mail/drafts/:id", "session", ({ params, body, principal }) => {
  let outgoing;
  try {
    outgoing = validateOutgoing({ to: body?.to, subject: body?.subject, body: body?.body });
  } catch (e) {
    rejectBadDraftInput(e);
  }
  const edited = getDraftStore().edit(params.id, principal.adminId, {
    to: outgoing.to,
    subject: outgoing.subject,
    body: outgoing.text,
  });
  if (!edited) throw new AuthError(404, "not_found"); // terminal, foreign and unknown alike
  audit("mail.draft_edited", { admin: principal.adminId, status: "pending_review" });
  return edited;
});
route("POST", "/api/mail/drafts/:id/send", "session", async ({ params, body, principal }) => {
  if (body.confirm !== "ENVIAR") throw new AuthError(400, "confirmation_required");
  const pending = getDraftStore().get(params.id, principal.adminId);
  if (!pending || pending.state !== "pending") throw new AuthError(404, "not_found");
  getMailService().peekRate(principal.adminId, pending.account, "send"); // reject before consuming the draft
  const draft = getDraftStore().claim(params.id, principal.adminId); // single-use claim, before sending
  if (!draft) throw new AuthError(404, "not_found");
  try {
    const result = await getMailService().send(principal.adminId, draft.account, {
      to: draft.to,
      subject: draft.subject,
      body: draft.body,
      confirm: "ENVIAR",
    });
    getDraftStore().settle(params.id, principal.adminId, "sent");
    return { ...result, state: "sent" };
  } catch (e) {
    // Ambiguous provider result → `unknown`: the message MAY have gone out, so never invite a resend.
    getDraftStore().settle(
      params.id,
      principal.adminId,
      e?.outcome === "unknown" ? "unknown" : "failed",
    );
    throw e;
  }
});

// ---------- AgentMail (integração server-side; ver server/agentmail.js) ----------
// Webhook `message.received` (Svix): rota PÚBLICA por natureza — AgentMail que entrega — mas
// autenticada pela assinatura HMAC do envelope e dedupe por svix-id. O choke point continua sendo
// a única porta de auth: qualquer desvio de assinatura/segredo é 400/503 fail-closed.
route(
  "POST",
  "/api/integrations/agentmail/webhook",
  "public",
  ({ rawBody: raw, req }) => {
    const cfg = agentMailConfig();
    if (!cfg.enabled) {
      audit("agentmail.webhook_rejected", { status: "integration_disabled", account: "agentmail" });
      throw new AuthError(503, "integration_disabled");
    }
    if (!cfg.webhookSecret) {
      audit("agentmail.webhook_rejected", { status: "secret_missing", account: "agentmail" });
      throw new AuthError(503, "integration_unconfigured");
    }
    const svixId = req.headers["svix-id"];
    const verified = verifySvixSignature(raw, req.headers, cfg.webhookSecret);
    if (!verified) {
      audit("agentmail.webhook_rejected", {
        status: svixId ? "bad_signature" : "missing_headers",
        account: "agentmail",
      });
      throw new AuthError(400, "invalid_signature");
    }
    let evt = null;
    try {
      evt = JSON.parse(raw.toString("utf8"));
    } catch {
      audit("agentmail.webhook_rejected", { status: "bad_json", account: "agentmail" });
      throw new AuthError(400, "invalid_json");
    }
    const m = evt?.message ?? {};
    const dup = insertAgentMailEvent({
      svixId,
      eventType: evt?.event_type,
      eventId: evt?.event_id,
      inboxId: m.inbox_id,
      threadId: m.thread_id,
      messageId: m.message_id,
      from: m.from,
      subject: m.subject,
      to: m.to,
      receivedAt: m.created_at ?? m.timestamp,
    });
    audit(dup ? "agentmail.webhook_received" : "agentmail.webhook_duplicate", {
      status: "accepted",
      account: "agentmail",
      type: String(evt?.event_type ?? "").slice(0, 64),
    });
    return { ok: true, duplicated: !dup };
  },
  { raw: true },
);

// Diagnóstico da integração (somente sessão verificada): SEM extrair segredos — só presença.
route("GET", "/api/integrations/agentmail/status", "session", ({ principal }) => {
  const cfg = agentMailConfig(process.env, getSettings(principal.adminId));
  return {
    enabled: cfg.enabled,
    hasApiKey: !!cfg.apiKey,
    hasWebhookSecret: !!cfg.webhookSecret,
    inboxId:
      cfg.inboxId && owns(principal.adminId, "agentmail_inbox", cfg.inboxId) ? cfg.inboxId : null,
    inboxClaimed: !!cfg.inboxId && owns(principal.adminId, "agentmail_inbox", cfg.inboxId),
    webhookId: cfg.webhookId || null,
  };
});

// Inbox ownership is an explicit claim, never inferred from the shared organization API key.
route("POST", "/api/integrations/agentmail/inbox/claim", "session", ({ body, principal }) => {
  try {
    return claimAgentMailInbox(principal.adminId, body);
  } catch (e) {
    if (e instanceof ClaimError) throw new AuthError(e.status, e.code);
    throw e;
  }
});

// Registro do webhook na AgentMail (sessão verificada): cria a assinatura nacional na org e
// grava o segredo retornado direto no global_settings — o segredo nunca passa pela resposta.
route(
  "POST",
  "/api/integrations/agentmail/webhook-register",
  "session",
  async ({ body, principal }) => {
    const publicUrl = String(body?.publicUrl || "").trim();
    if (!/^https:\/\/[a-z0-9.-]+(:\d+)?\/api\/integrations\/agentmail\/webhook$/.test(publicUrl))
      throw new AuthError(400, "invalid_public_url");
    const cfg = agentMailConfig(process.env, getSettings(principal.adminId));
    if (!cfg.enabled || !cfg.apiKey) throw new AuthError(400, "integration_missing_apikey");
    if (!cfg.inboxId || !owns(principal.adminId, "agentmail_inbox", cfg.inboxId))
      throw new AuthError(403, "inbox_not_owned");
    const client = createAgentMailClient(cfg);
    const webhook = await client.createWebhook(publicUrl, ["message.received"]);
    const data = { enabled: true, webhookId: String(webhook?.webhook_id ?? webhook?.id ?? "") };
    if (webhook?.secret) data.webhookSecret = String(webhook.secret);
    // allowGlobal integral: o chokepoint desta rota já garante isVerifiedAdmin (acesso "session").
    updateSettings({ integrations: { agentmail: data } });
    audit("agentmail.webhook_registered", {
      status: data.webhookId ? "registered" : "registered_no_id",
    });
    return { webhookId: data.webhookId, secretStored: !!data.webhookSecret, publicUrl };
  },
);

// Histórico de eventos recebidos (metadados, ordem cronológica decrescente): leitura por escopo.
route("GET", "/api/integrations/agentmail/events", "comms:read", ({ query, principal }) => {
  const limit = Number(query.get("limit"));
  return { events: listAgentMailEvents({ adminId: principal.adminId, limit }) };
});

// Caixa AgentMail pela mesma conta de ferramentas (leitura on-demand; conteúdo sanitizado a jusante
// quando usado como ferramenta — aqui é rota bruta da API): escopo comms:read, session/token.
route("GET", "/api/integrations/agentmail/messages", "comms:read", async ({ query, principal }) => {
  const cfg = agentMailConfig(process.env, getSettings(principal.adminId));
  if (!cfg.enabled || !cfg.apiKey) throw new AuthError(400, "integration_missing_apikey");
  const inboxId = cfg.inboxId;
  if (!inboxId || !owns(principal.adminId, "agentmail_inbox", inboxId))
    throw new AuthError(403, "inbox_not_owned");
  if (query.has("inbox") && query.get("inbox") !== inboxId)
    throw new AuthError(404, "inbox_not_found");
  const page = await getAgentMailClient().listMessages(inboxId, {
    limit: Math.max(1, Math.min(Number(query.get("limit")) || 10, 50)),
  });
  // Lista traz metadados apenas (como na referencia da API). Corpo só via get_message sob demanda.
  return { inboxId, messages: page?.messages ?? [], count: page?.count ?? 0 };
});

// ---------- authentication + authorization (single choke point) ----------
function authenticate(req) {
  const bearer = /^Bearer (.+)$/.exec(req.headers.authorization || "")?.[1];
  if (bearer) return { principal: auth.validateServiceToken(bearer), via: "token" };
  return { principal: auth.validateSession(readCookie(req)), via: "cookie" };
}

export function createApp(opts = {}) {
  setMailTransport(opts.mailTransport); // default: the mock placeholder transport
  setDraftStore(opts.draftStore);
  return createServer(async (req, res) => {
    const origin = req.headers.origin;
    if (!trusted(origin)) return send(res, 403, { error: "origin_not_allowed" }, undefined);
    if (req.method === "OPTIONS") return send(res, 204, "", origin, "text/plain");
    const url = new URL(req.url, "http://127.0.0.1");
    const r = routes.find((x) => x.method === req.method && x.re.test(url.pathname));
    if (!r) return send(res, 404, { error: "not_found" }, origin);
    try {
      let principal = null;
      if (r.access !== "public") {
        const a = authenticate(req);
        principal = a.principal;
        if (!principal) return send(res, 401, { error: "unauthenticated" }, origin);
        // CSRF: cookie sessions must echo the session-bound token on every state change.
        if (
          a.via === "cookie" &&
          MUTATING.has(req.method) &&
          !eq(req.headers["x-jarvis-csrf"], principal.csrf)
        ) {
          audit("authz.csrf_rejected", { route: r.pattern });
          return send(res, 403, { error: "csrf" }, origin);
        }
        const ok = r.access === "session" ? isVerifiedAdmin(principal) : can(principal, r.access);
        if (!ok) {
          audit("authz.denied", { route: r.pattern, need: r.access, principal: principal.type });
          return send(res, 403, { error: "forbidden", need: r.access }, origin);
        }
      }
      const ct = req.headers["content-type"] || "";
      let body = {},
        form = null,
        rawBody = null;
      if (ct.includes("multipart/form-data")) {
        if (Number(req.headers["content-length"] || 0) > MAX_UPLOAD)
          throw new AuthError(413, "payload_too_large");
        form = await readLimitedForm(req, url, MAX_UPLOAD);
      } else if (r.raw && req.method !== "GET" && req.method !== "DELETE") {
        if (Number(req.headers["content-length"] || 0) > MAX_BODY)
          throw new AuthError(413, "payload_too_large");
        rawBody = await readRawLimited(req, MAX_BODY);
      } else if (req.method !== "GET" && req.method !== "DELETE") body = await readJson(req);
      const m = url.pathname.match(r.re);
      const out = await r.fn({
        params: m.groups || {},
        query: url.searchParams,
        body,
        form,
        rawBody,
        principal,
        req,
        res,
      });
      if (out?.__stream) return; // resposta já concluída pelo handler (NDJSON de progresso)
      const extra = res.setCookie ? { "set-cookie": res.setCookie } : undefined;
      if (out?.__redirect) {
        res.writeHead(303, {
          location: out.__redirect,
          "cache-control": "no-store",
          "referrer-policy": "no-referrer",
          "x-content-type-options": "nosniff",
        });
        return res.end();
      }
      if (out?.__raw) return send(res, 200, out.__raw, origin, out.__type, extra);
      return send(res, 200, out ?? { ok: true }, origin, "application/json", extra);
    } catch (e) {
      if (
        e instanceof AuthError ||
        (e && typeof e.status === "number" && typeof e.code === "string")
      ) {
        if (e.status === 413) {
          res.setHeader("connection", "close"); // unread body: never reuse this socket
          try {
            req.resume();
          } catch {}
        }
        const extra = e.retryAfter ? { "retry-after": String(e.retryAfter) } : undefined;
        return send(
          res,
          e.status,
          {
            error: e.code,
            ...(e.retryAfter ? { retryAfter: e.retryAfter } : {}),
            // P2-A: estado recuperável (ex.: `warming_up`) para o cliente orientar o usuário.
            ...(e.state ? { state: e.state } : {}),
          },
          origin,
          "application/json",
          extra,
        );
      }
      console.error(`[erro] ${req.method} ${url.pathname}: ${e.message}`); // never logs bodies/headers
      return send(res, 500, { error: "internal_error" }, origin);
    }
  });
}

// ---------- main ----------
const isMain = !!process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain && !process.env.JARVIS_NO_LISTEN) {
  const PORT = Number(process.env.JARVIS_PORT || 7777);
  const HOST = process.env.JARVIS_HOST || "127.0.0.1";
  const boot = auth.ensureBootstrap();
  createApp().listen(PORT, HOST, () => {
    console.log(`\n  J.A.R.V.I.S. local ativo em http://${HOST}:${PORT}`);
    console.log("  Painel: http://localhost:8080  (o painel detecta este serviço automaticamente)");
    if (boot) {
      console.log("\n  PRIMEIRO ACESSO: nenhum administrador cadastrado.");
      console.log(
        `  O código de configuração (uso único, válido por 15 min) está em: ${boot.file}`,
      );
      console.log(
        "  Abra o arquivo, copie o código e cole no painel. Ao reiniciar o serviço, um novo código é gerado.\n",
      );
    }
  });
  setInterval(() => auth.purgeAttempts(), 3600_000).unref();
  startScheduler();
  recoverWorkforceRuns();
  recoverKhJobs();
  recoverWfRuns();
  // Tick do Workflow Studio: retoma runs de aprovações resolvidas e waits expirados;
  // tick da Computer Intelligence: ações verification_pending após resolução D9.
  setInterval(() => tickWfRuns().catch(() => {}), 20_000).unref();
  setInterval(() => tickCiSessions().catch(() => {}), 20_000).unref();
  registerCiWorkflowNodes(); // nós computer_* no Workflow Engine (Fase 5)
  // P2: inbound messages run as the admin whose own settings hold the channel credentials.
  const activeAdmins = () =>
    db
      .prepare("SELECT id FROM admins WHERE active = 1")
      .all()
      .map((r) => r.id);
  startTelegramPolling(async (adminId, channel, text) => {
    const principal = {
      type: "channel",
      channel,
      adminId,
      scopes: ["chat", "web", "memories:read"],
    }; // no host/comms from an inbound message
    await Promise.all(triggerByText("message", text, adminId));
    const r = await runAgent({
      messages: [{ role: "user", content: text }],
      autonomy: "confirm",
      principal,
    });
    // Auto-resposta DESABILITADA por padrão: enviar sem aprovação humana é uma política explícita,
    // não um padrão. Só envia quando `comms.<canal>.autoReply === true` estiver configurado, e
    // ainda assim revalida canal+destinatário no momento do envio (impressão digital).
    const cfg = getSettings(adminId).comms?.[channel];
    if (cfg?.autoReply !== true) {
      audit("send_message(auto_reply_skipped)", { channel, reason: "policy_disabled" });
      return;
    }
    const d = describeSend(adminId, channel, r.reply);
    if (!d.ok) {
      audit("send_message(auto_reply_skipped)", { channel, reason: "channel_unavailable" });
      return;
    }
    await sendMessage(
      adminId,
      channel,
      r.reply + (r.pending.length ? "\n\n(Há uma ação aguardando sua aprovação no painel.)" : ""),
      sendFingerprint({
        ...d,
        text:
          r.reply +
          (r.pending.length ? "\n\n(Há uma ação aguardando sua aprovação no painel.)" : ""),
      }),
    );
  }, activeAdmins);
}

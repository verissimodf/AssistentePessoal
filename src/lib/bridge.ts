// Client for the local Jarvis service (server/ folder, runs on the user's machine).
// When the service is unreachable the panel falls back to a demo store in localStorage,
// so the interface still works in the online preview.
import { useEffect, useState } from "react";

// Loopback hosts keep the explicit service port (local development / systemd service).
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/**
 * Where the panel should reach the local service.
 *  - loopback            → http://localhost:7777 (local dev, service on its own port)
 *  - HTTPS origin        → the page's own origin (a reverse proxy serves the panel and the
 *                          API under one hostname; no fixed :7777 and no cross-origin CORS)
 *  - any other HTTP host → <protocol>//<hostname>:7777 (e.g. the Tailscale relay, where the
 *                          API stays on port 7777 of the same tailnet host)
 * Kept pure so it can be unit-tested without a DOM.
 */
export function resolveBridge(loc: {
  protocol: string;
  hostname?: string;
  origin?: string;
}): string {
  const hostname = loc?.hostname || "";
  if (!hostname) return "http://localhost:7777";
  if (LOOPBACK_HOSTS.has(hostname)) return `${loc.protocol}//${hostname}:7777`;
  if (loc.protocol === "https:") return loc.origin || `https://${hostname}`;
  return `${loc.protocol}//${hostname}:7777`;
}

export const DEFAULT_BRIDGE =
  typeof window !== "undefined" && window.location
    ? resolveBridge(window.location)
    : "http://localhost:7777";
export const bridgeUrl = () =>
  (typeof localStorage !== "undefined" && localStorage.getItem("jarvis.bridge")) || DEFAULT_BRIDGE;

let online: boolean | null = null;
const listeners = new Set<(v: boolean) => void>();

let setupRequired = false;
export async function ping(): Promise<boolean> {
  try {
    const r = await fetch(`${bridgeUrl()}/api/health`, { signal: AbortSignal.timeout(1500) });
    online = r.ok;
    if (r.ok) setupRequired = !!(await r.json()).setupRequired;
  } catch {
    online = false;
  }
  listeners.forEach((l) => l(online!));
  return online;
}

// ---------- authentication (local service) ----------
// The session lives in an HttpOnly cookie the panel cannot read. The CSRF token is kept only
// in memory (never localStorage) and re-fetched from /api/auth/me after a reload.
export type AuthState = "unknown" | "demo" | "setup" | "login" | "ok";
let csrf: string | null = null;
let authState: AuthState = "unknown";
let me: { id: string; username: string } | null = null;
const authListeners = new Set<(s: AuthState) => void>();
const setAuth = (s: AuthState) => {
  authState = s;
  authListeners.forEach((l) => l(s));
};
export const currentAdmin = () => me;

export async function refreshAuth(): Promise<AuthState> {
  if (!(await ping())) {
    csrf = null;
    me = null;
    setAuth("demo");
    return authState;
  }
  if (setupRequired) {
    setAuth("setup");
    return authState;
  }
  const r = await fetch(`${bridgeUrl()}/api/auth/me`, { credentials: "include" }).catch(() => null);
  if (r?.ok) {
    const j = await r.json();
    csrf = j.csrf;
    me = j.admin;
    setAuth("ok");
  } else {
    csrf = null;
    me = null;
    setAuth("login");
  }
  return authState;
}
export function useAuthState() {
  const [s, setS] = useState<AuthState>(authState);
  useEffect(() => {
    authListeners.add(setS);
    refreshAuth();
    return () => {
      authListeners.delete(setS);
    };
  }, []);
  return s;
}
async function authPost(path: string, body: unknown) {
  const r = await fetch(`${bridgeUrl()}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok)
    throw Object.assign(new Error(j.error || String(r.status)), {
      code: j.error,
      retryAfter: j.retryAfter,
    });
  return j;
}
export async function login(username: string, password: string) {
  const j = await authPost("/api/auth/login", { username, password });
  csrf = j.csrf;
  me = j.admin;
  setAuth("ok");
}
export async function setupFirstAdmin(token: string, username: string, password: string) {
  await authPost("/api/auth/setup", { token: token.trim(), username, password });
  setupRequired = false;
  await login(username, password);
}
export async function logout() {
  await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => undefined);
  csrf = null;
  me = null;
  setAuth("login");
}

export function useBridgeStatus() {
  const [state, setState] = useState<boolean | null>(online);
  useEffect(() => {
    listeners.add(setState);
    ping();
    const id = setInterval(ping, 10000);
    return () => {
      listeners.delete(setState);
      clearInterval(id);
    };
  }, []);
  return state;
}

export async function api<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const isForm = init.body instanceof FormData;
  const method = (init.method || "GET").toUpperCase();
  const h: Record<string, string> = { ...((init.headers as Record<string, string>) || {}) };
  if (!isForm) h["content-type"] = "application/json";
  if (method !== "GET" && csrf) h["x-jarvis-csrf"] = csrf;
  const r = await fetch(`${bridgeUrl()}${path}`, { ...init, credentials: "include", headers: h });
  if (r.status === 401) {
    csrf = null;
    me = null;
    setAuth(setupRequired ? "setup" : "login");
  }
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  const ct = r.headers.get("content-type") || "";
  return (ct.includes("json") ? r.json() : r.blob()) as Promise<T>;
}

// ---------- documents & hybrid RAG ----------
export type Doc = {
  id: string;
  name: string;
  mime: string;
  size: number;
  created_at: string;
  chunk_count?: number;
  rag_status?: "hybrid" | "lexical_only" | "lexical" | string;
  search_result?: {
    snippet: string;
    chunk_index: number;
    search_mode: string;
    fallback_reason?: string;
    score: number;
  };
};

export type DocChunk = {
  id: string;
  document_id: string;
  chunk_index: number;
  content: string;
  token_estimate: number;
  has_embedding?: number | boolean;
  embedding_model?: string | null;
  created_at?: string;
};

export async function listDocuments(): Promise<Doc[]> {
  if (await ping()) return api<Doc[]>("/api/documents");
  return [];
}

export async function getDocumentChunks(id: string): Promise<DocChunk[]> {
  if (await ping()) return api<DocChunk[]>(`/api/documents/${encodeURIComponent(id)}/chunks`);
  return [];
}

export type ReindexResult = {
  ok: boolean;
  id: string;
  rag_status: string;
  vectorizedChunks?: number | undefined;
  reason?: string | undefined;
};

export async function reindexDocument(id: string): Promise<ReindexResult | null> {
  if (!(await ping())) return null;
  try {
    return await api<ReindexResult>(`/api/documents/${encodeURIComponent(id)}/reindex`, {
      method: "POST",
    });
  } catch {
    return null;
  }
}

export type ReindexPendingResult = {
  ok: boolean;
  processed: number;
  upgraded: number;
  ids?: string[];
  reason?: string;
};

export async function reindexAllPendingDocuments(): Promise<ReindexPendingResult | null> {
  if (!(await ping())) return null;
  try {
    return await api<ReindexPendingResult>("/api/documents/reindex-pending", {
      method: "POST",
    });
  } catch {
    return null;
  }
}

// ---------- generic collections (server first, demo fallback) ----------
export type Memory = { id: string; content: string; tags: string; created_at: string };
export type Agent = {
  id: string;
  name: string;
  instructions: string;
  provider: string;
  model: string;
  tools: string[];
  active?: boolean;
};
export type Bot = {
  id: string;
  name: string;
  goal: string;
  agent_id: string;
  trigger_type: "daily" | "interval" | "voice" | "file" | "message";
  trigger_value: string;
  autonomy: "confirm" | "safe" | "full";
  max_steps: number;
  enabled: boolean;
  last_run?: string;
  scopes?: string[];
  owner_admin_id?: string | null;
};
export type Run = {
  id: string;
  bot_id: string;
  started_at: string;
  status: string;
  output: string;
};

const seed: Record<string, unknown[]> = {
  memories: [
    {
      id: "m1",
      content: "O usuário prefere respostas curtas e objetivas.",
      tags: "preferência",
      created_at: new Date().toISOString(),
    },
    {
      id: "m2",
      content: "Reunião semanal da equipe toda segunda às 9h.",
      tags: "agenda",
      created_at: new Date().toISOString(),
    },
  ],
  agents: [
    {
      id: "jarvis",
      name: "Jarvis",
      instructions:
        "Você é J.A.R.V.I.S., assistente pessoal leal, preciso e elegante. Responda no idioma do usuário.",
      provider: "ollama",
      model: "qwen2.5:7b",
      tools: ["web_search", "remember", "recall", "run_command"],
      active: true,
    },
  ],
  bots: [
    {
      id: "b1",
      name: "Resumo matinal",
      goal: "Pesquise as principais notícias de tecnologia e me envie um resumo no Telegram.",
      agent_id: "jarvis",
      trigger_type: "daily",
      trigger_value: "08:00",
      autonomy: "safe",
      max_steps: 8,
      enabled: true,
    },
  ],
};

function demoGet<T>(name: string): T[] {
  const raw = localStorage.getItem(`jarvis.demo.${name}`);
  if (raw) return JSON.parse(raw);
  return (seed[name] as T[]) || [];
}
function demoSet(name: string, items: unknown[]) {
  localStorage.setItem(`jarvis.demo.${name}`, JSON.stringify(items));
}

export function collection<T extends { id: string }>(name: string) {
  return {
    async list(q = ""): Promise<T[]> {
      if (await ping()) return api<T[]>(`/api/${name}${q ? `?q=${encodeURIComponent(q)}` : ""}`);
      const items = demoGet<T>(name);
      return q
        ? items.filter((i) => JSON.stringify(i).toLowerCase().includes(q.toLowerCase()))
        : items;
    },
    async save(item: Partial<T>): Promise<T> {
      if (online) {
        return item.id
          ? api<T>(`/api/${name}/${item.id}`, { method: "PUT", body: JSON.stringify(item) })
          : api<T>(`/api/${name}`, { method: "POST", body: JSON.stringify(item) });
      }
      const items = demoGet<T>(name);
      const full = {
        created_at: new Date().toISOString(),
        ...item,
        id: item.id || crypto.randomUUID(),
      } as unknown as T;
      const idx = items.findIndex((i) => i.id === full.id);
      if (idx >= 0) items[idx] = { ...items[idx], ...full };
      else items.unshift(full);
      demoSet(name, items);
      return full;
    },
    async remove(id: string) {
      if (online) return api(`/api/${name}/${id}`, { method: "DELETE" });
      demoSet(
        name,
        demoGet<T>(name).filter((i) => i.id !== id),
      );
      return undefined;
    },
  };
}

// ---------- settings ----------
type SettingsRecord = {
  enabled?: boolean;
  baseUrl?: string;
  command?: string;
  apiKey?: string;
  hasKey?: boolean;
  model?: string;
  [key: string]: unknown;
};
export type Settings = {
  general: { agentName: string; language: string; [key: string]: unknown };
  providers: Record<string, SettingsRecord>;
  integrations: Record<string, SettingsRecord>;
  comms: Record<string, SettingsRecord>;
  voice: {
    tts: string;
    stt: string;
    sensitivity: number;
    hotkey: string;
    wake: { clap: boolean; word: boolean; hotkey: boolean; ptt: boolean; [key: string]: boolean };
    cloneEngine?: string;
    clonedVoiceId?: string;
    clonedName?: string;
    localVoiceUrl?: string;
    [key: string]: unknown;
  };
  host: { enabled: boolean; allowlist: string; [key: string]: unknown };
  /** JEV Reflex (advisory, opt-in — Configurações → Preferências). */
  reflex?: {
    enabled?: boolean;
    model?: string;
    threshold?: number;
    [key: string]: unknown;
  };
};
export const DEFAULT_SETTINGS: Settings = {
  general: { agentName: "Jarvis", language: "pt" },
  providers: {},
  integrations: {},
  comms: {},
  voice: {
    tts: "browser",
    stt: "browser",
    wake: { clap: true, word: true, hotkey: true, ptt: true },
    sensitivity: 6,
    hotkey: "Ctrl+Shift+J",
  },
  host: { enabled: false, allowlist: "ls, dir, git status, code ., start, xdg-open" },
  reflex: { enabled: false, model: "" },
};

export async function loadSettings(): Promise<Settings> {
  if (await ping()) return { ...DEFAULT_SETTINGS, ...(await api<Settings>("/api/settings")) };
  const raw = localStorage.getItem("jarvis.demo.settings");
  return raw ? { ...DEFAULT_SETTINGS, ...JSON.parse(raw) } : DEFAULT_SETTINGS;
}
export async function saveSettings(s: Settings) {
  if (online) return api("/api/settings", { method: "PUT", body: JSON.stringify(s) });
  localStorage.setItem("jarvis.demo.settings", JSON.stringify(s));
  return undefined;
}

// ---------- chat & histórico de conversas (Fase H: fonte da verdade no servidor) ----------
export type ToolCall = { name: string; input: unknown; output?: string };
export type PendingAction = { id: string; command: string; status?: string };
/** Fonte preservada no momento da resposta (document_search; sobrevive a edições do documento). */
export type Citation = {
  documentId: string;
  name: string;
  chunk_index: number;
  search_mode: string;
  score: number;
};
/** JEV Reflex (advisory, opt-in): decisão pré-resposta registrada; nunca gatilha/bloqueia. */
export type ReflexRun = {
  source: "jev" | "fallback";
  route?: string;
  confidence?: number;
  reason?: string;
  model?: string;
  latencyMs: number;
};
export type ChatStreamEvent =
  | { type: "reflex"; reflex: ReflexRun }
  | { type: "progress"; step: number; tool?: string }
  | { type: "final"; exchange: ChatExchange }
  | { type: "error"; code: string };
export type ChatReply = {
  reply: string;
  reasoning?: string;
  tools?: ToolCall[];
  pending?: PendingAction[];
};
export type ConversationSummary = {
  id: string;
  title: string;
  agent_id?: string | null;
  created_at: string;
  updated_at: string;
};
export type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  meta?: {
    reasoning?: string;
    tools?: ToolCall[];
    pending?: PendingAction[];
    citations?: Citation[];
    reflex?: ReflexRun;
  } | null;
};
export type ChatExchange = ChatReply & {
  conversation: ConversationSummary | null;
  userMessage?: { id: string; content: string; created_at: string };
  assistantMessageId?: string;
  duplicate?: boolean;
  citations?: Citation[];
  reflex?: ReflexRun | null;
};

/** Conversas do administrador, mais recentes primeiro (vazio no modo demonstração). */
export async function listConversations(): Promise<ConversationSummary[]> {
  if (await ping()) return api<ConversationSummary[]>("/api/conversations");
  return [];
}

/** Uma conversa com as mensagens persistidas (404 se não existir ou não for do usuário). */
export async function openConversation(
  id: string,
): Promise<{ conversation: ConversationSummary; messages: ConversationMessage[] }> {
  return api(`/api/conversations/${encodeURIComponent(id)}`);
}

export async function deleteConversation(id: string): Promise<void> {
  if (await ping()) await api(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
}

/** Cria uma conversa vazia com título explícito (usada pelo Multimodal Studio). */
export async function createConversation(title: string): Promise<ConversationSummary | null> {
  if (!(await ping())) return null;
  return await api<ConversationSummary>("/api/conversations", {
    method: "POST",
    body: JSON.stringify({ title }),
  });
}

/**
 * Envia UMA mensagem e recebe a troca persistida. `clientMsgId` é gerado no cliente e reutilizado
 * em retries — o servidor nunca duplica a mesma mensagem. Com `conversationId` nulo, o servidor
 * cria a conversa (título derivado da mensagem).
 */
export async function chatConversation(
  conversationId: string | null,
  message: string,
  clientMsgId: string,
  agentId?: string,
): Promise<ChatExchange> {
  if (await ping())
    return api<ChatExchange>("/api/chat", {
      method: "POST",
      body: JSON.stringify({
        conversationId: conversationId ?? undefined,
        message,
        clientMsgId,
        agentId,
      }),
    });
  await new Promise((r) => setTimeout(r, 700));
  return {
    conversation: null,
    reply: `**Modo demonstração.** Recebi: _"${message}"_.\n\nPara respostas reais, instale o Jarvis local (scripts/instalar) e configure um provedor como Ollama em **Configurações**.`,
    reasoning: "Serviço local indisponível; resposta simulada.",
    tools: [],
    pending: [],
  };
}

/**
 * Envio com STREAMING de progresso (/api/chat/stream, NDJSON): os eventos ao vivo chegam por
 * `onEvent` (reflex/progress) e a troca PERSISTIDA completa chega no evento `final`.
 *
 * Retornos:
 *  - `ChatExchange`        → sucesso (evento final recebido; use-o como no chatConversation);
 *  - `null`                → stream indisponível: chame o fallback `chatConversation(...)`;
 *  - `Error("stream_incomplete:")` or `("stream_incomplete:<code>")` → o stream começou, mas
 *    não terminou (o run falhou): NÃO rode o fallback (evita reexecutar um run já a meio);
 *    propague para o Fluxo de retry da interface (clientMsgId idempotente).
 *
 * O POST /api/chat continua sendo a fonte de verdade para compatibilidade/demonstração.
 */
export async function chatConversationStream(
  conversationId: string | null,
  message: string,
  clientMsgId: string,
  agentId: string | undefined,
  onEvent: (e: ChatStreamEvent) => void,
  signal?: AbortSignal,
): Promise<ChatExchange | null> {
  if (!(await ping())) return null;
  const h: Record<string, string> = { "content-type": "application/json" };
  if (csrf) h["x-jarvis-csrf"] = csrf;
  let res: Response;
  try {
    res = await fetch(`${bridgeUrl()}/api/chat/stream`, {
      method: "POST",
      headers: h,
      body: JSON.stringify({
        conversationId: conversationId ?? undefined,
        message,
        clientMsgId,
        agentId,
      }),
      credentials: "include",
      ...(signal ? { signal } : {}),
    });
  } catch {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return null; // rede falhou antes do stream: fallback normal
  }
  if (!res.ok || !res.body) return null; // (ex.: 401/404/502/rota ausente em build antigo) — fallback
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let exchange: ChatExchange | null = null;
  let lastError = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let ev: ChatStreamEvent;
      try {
        ev = JSON.parse(line);
      } catch {
        continue; // linha parcial/corrompida: em vez de mentir, ignora
      }
      if (ev.type === "final") exchange = ev.exchange;
      else if (ev.type === "error") lastError = ev.code;
      onEvent(ev);
    }
  }
  if (!exchange) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    throw new Error(`stream_incomplete:${lastError}`); // run falhou no meio: propagar para retry
  }
  return exchange;
}

// --- Fase I: Diagnóstico Operacional (somente leitura, sessão administrativa) -------------

export type DiagnosticEvidence = {
  metodo: "codigo" | "config" | "teste" | "execucao" | "documento";
  ref: string;
  data: string | null;
  nota?: string;
};

export type DiagnosticItem = {
  id: string;
  categoria: "servico" | "ferramenta" | "acesso" | "integracao" | "automacao" | "dados";
  nome: string;
  estado: string;
  flags: { implementado: boolean; habilitado: boolean; testado: boolean };
  evidencias: DiagnosticEvidence[];
  limitacoes: string[];
  confianca: "alta" | "media" | "baixa";
  detalhes?: Record<string, string | number | boolean | null>;
};

export type DiagnosticInventory = {
  generatedAt: string;
  versao: { app: string | null; banco: number | null; node: string | null; uptimeSegundos: number };
  resumo: {
    saude: "ok" | "atencao";
    total: number;
    porEstado: Record<string, number>;
    pendencias: number;
  };
  itens: DiagnosticItem[];
  testes: Array<{ arquivo: string; area: string }>;
  riscos: string[];
  oportunidades: string[];
  decisoesHumanas: string[];
  notas: string[];
};

/** Inventário de diagnóstico (somente leitura; exige sessão administrativa no servidor). */
export async function loadDiagnostics(): Promise<DiagnosticInventory | null> {
  if (await ping()) return api<DiagnosticInventory>("/api/diagnostics");
  return null;
}

// ---------- P0.1: aprovações, execuções (ledger) e auditoria (fonte de verdade = servidor) ----------
export type ApprovalRow = { id: string; command: string; status: string; createdAt: string };
export type BrowserApprovalReview = {
  operation: string;
  host: string | null;
  selector: string | null;
  hasText: boolean;
  preview: string | null;
  fingerprint: string;
};
export type ExecutionRow = {
  id: string;
  approvalId: string | null;
  kind: string;
  state: string;
  exitCode: number | null;
  verification: string;
  verifiedBy: string;
  correlation: string | null;
  auditId: number | null;
  at: string;
};
export type AuditRow = { id: number; at: string; kind: string; detail: string };

/** Aprovações do administrador. `null` = indisponível (offline) — nunca dados de demonstração. */
export async function listApprovals(): Promise<ApprovalRow[] | null> {
  if (await ping()) return (await api<{ approvals: ApprovalRow[] }>("/api/approvals")).approvals;
  return null;
}
/** Ledger de execuções (evidências) do administrador. `null` = indisponível (offline). */
export async function listExecutions(): Promise<ExecutionRow[] | null> {
  if (await ping())
    return (await api<{ executions: ExecutionRow[] }>("/api/executions")).executions;
  return null;
}

// ---------- P0.2: foco da sessão (objetivo/resumo/decisões) — explícito, por dono ----------
// Pendências e "próximo passo" NÃO vêm daqui: o painel deriva-os de aprovações/execuções reais.
export type SessionFocus = {
  objective: string;
  summary: string;
  decisions: string[];
  updatedAt: string | null;
};

/** Foco do administrador autenticado. `null` = indisponível (offline) — nunca um objetivo de demonstração. */
export async function loadSessionFocus(): Promise<SessionFocus | null> {
  if (await ping()) return api<SessionFocus>("/api/session-focus");
  return null;
}
/** Grava o foco do próprio administrador (PUT com CSRF). Lança em erro HTTP (400/403). */
export async function saveSessionFocus(focus: {
  objective: string;
  summary: string;
  decisions: string[];
}): Promise<SessionFocus> {
  return api<SessionFocus>("/api/session-focus", { method: "PUT", body: JSON.stringify(focus) });
}

// ---------- P0.2: proveniência das configurações (origem de cada valor, nunca o valor) ----------
export type ProvenanceRow = {
  path: string;
  origin: "default" | "personal" | "global";
  class: string;
  secret: boolean;
};
export type Provenance = {
  keys: ProvenanceRow[];
  env: {
    reported: { name: string; set: boolean; value: string | null }[];
    presenceOnly: { name: string; set: boolean }[];
  };
};
/** Inventário de proveniência. `null` = indisponível (offline) — nunca um inventário de demonstração. */
export async function loadProvenance(): Promise<Provenance | null> {
  try {
    if (await ping()) return await api<Provenance>("/api/settings/provenance");
  } catch {
    /* offline ou sessão expirada */
  }
  return null;
}
/** Histórico de auditoria (escopo `audit:read`). `null` = indisponível ou sem permissão. */
export async function loadAudit(): Promise<AuditRow[] | null> {
  if (!(await ping())) return null;
  try {
    return await api<AuditRow[]>("/api/audit");
  } catch {
    return null;
  }
}

// ---------- skills & global hub ----------
export type SkillSummary = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  category: string;
  path?: string;
  score?: number;
};

export type ProviderTelemetry = {
  providers: Record<
    string,
    {
      calls: number;
      successes: number;
      failures: number;
      fallbacksTriggered: number;
      totalLatencyMs: number;
      avgLatencyMs: number;
      totalEstimatedTokens: number;
    }
  >;
  profiles: {
    realtime_voice: number;
    code_engineering: number;
    rag_knowledge: number;
    general: number;
  };
  voice?: {
    totalCalls: number;
    totalLatencyMs: number;
    avgLatencyMs: number;
    bargeInCount: number;
  };
  totalCalls: number;
  totalFallbacks: number;
};

export type RouterStatus = {
  activeAgent: string;
  primary: {
    provider: string;
    model: string;
    baseUrl?: string;
  };
  fallbacks: Array<{
    provider: string;
    model: string;
  }>;
  totalProviders: number;
  resilientFallbackEnabled: boolean;
  profiles?: string[];
  telemetry?: ProviderTelemetry;
};

export type SkillsResponse = {
  total: number;
  totalCatalog: number;
  categories: string[];
  skills: SkillSummary[];
  routerStatus?: RouterStatus;
};

export type SkillDetail = {
  id: string;
  name: string;
  description: string;
  tags: string[];
  path: string;
  content: string;
};

export async function listSkills(query?: {
  q?: string | undefined;
  category?: string | undefined;
  limit?: number | undefined;
}): Promise<SkillsResponse | null> {
  if (!(await ping())) return null;
  const params = new URLSearchParams();
  if (query?.q) params.set("q", query.q);
  if (query?.category) params.set("category", query.category);
  if (query?.limit !== undefined && query?.limit !== null) params.set("limit", String(query.limit));
  const qs = params.toString() ? `?${params.toString()}` : "";
  try {
    return await api<SkillsResponse>(`/api/skills${qs}`);
  } catch {
    return null;
  }
}

export async function getSkillDetail(id: string): Promise<SkillDetail | null> {
  if (!(await ping())) return null;
  try {
    return await api<SkillDetail>(`/api/skills/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

export async function getRouterTelemetry(): Promise<ProviderTelemetry | null> {
  if (!(await ping())) return null;
  try {
    return await api<ProviderTelemetry>("/api/router/telemetry");
  } catch {
    return null;
  }
}

// ---------- agent workforce ----------
export type WorkforceRole = "orchestrator" | "specialist" | "worker";
export type WorkforceRunStatus =
  "queued" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled" | "unknown";
export type WorkforceVerification = "verified" | "unverified" | "partial" | "none";

export type WorkforceDefinition = {
  id: string;
  name: string;
  role: WorkforceRole;
  description: string;
  version: number;
  instructions: string;
  model_preferences: { provider: string | null; model: string | null };
  permitted_tools: string[];
  permission_scopes: string[];
  resource_budget: {
    max_depth: number;
    max_children: number;
    max_tree_runs: number;
    max_tool_calls: number;
    max_model_calls: number;
    max_tokens: number | null;
    runtime_ms: number;
    max_retries: number;
    max_concurrent_children: number;
  };
  execution_limits: Record<string, unknown>;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type WorkforceRunChild = {
  id: string;
  definition: string | null;
  status: string;
  verification: string;
  depth: number;
  created_at: string;
};

export type WorkforceRun = {
  id: string;
  definition_id: string;
  parent_run_id: string | null;
  correlation_id: string;
  objective: string;
  status: WorkforceRunStatus;
  depth: number;
  usage: { tool_calls?: number; model_calls?: number; estimated_tokens?: number };
  result: {
    status: string;
    output: string;
    tool_names: string[];
    children: { id: string; definition: string; status: string }[];
    limitations: string[];
  } | null;
  error_code: string | null;
  verification: WorkforceVerification;
  definition: { name: string; role: string } | null;
  children: WorkforceRunChild[];
  created_at: string;
  finished_at: string | null;
};

export type WorkforceTemplate = {
  key: string;
  name: string;
  role: WorkforceRole;
  description: string;
  permitted_tools: string[];
  permission_scopes: string[];
};

export type WorkforceDefinitionBody = Omit<Partial<WorkforceDefinition>, "resource_budget"> & {
  name: string;
  resource_budget?: Partial<WorkforceDefinition["resource_budget"]>;
};

export async function listWorkforceAgents(): Promise<WorkforceDefinition[] | null> {
  if (!(await ping())) return null;
  try {
    return await api<WorkforceDefinition[]>("/api/workforce/agents");
  } catch {
    return null;
  }
}

export async function createWorkforceAgent(
  body: WorkforceDefinitionBody,
): Promise<WorkforceDefinition | null> {
  if (!(await ping())) return null;
  return await api<WorkforceDefinition>("/api/workforce/agents", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateWorkforceAgent(
  id: string,
  body: WorkforceDefinitionBody,
): Promise<WorkforceDefinition | null> {
  if (!(await ping())) return null;
  return await api<WorkforceDefinition>(`/api/workforce/agents/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteWorkforceAgent(id: string): Promise<{ ok: boolean } | null> {
  if (!(await ping())) return null;
  return await api<{ ok: boolean }>(`/api/workforce/agents/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function runWorkforceAgent(
  id: string,
  objective: string,
): Promise<{ run: WorkforceRun; deduplicated: boolean } | null> {
  if (!(await ping())) return null;
  return await api<{ run: WorkforceRun; deduplicated: boolean }>(
    `/api/workforce/agents/${encodeURIComponent(id)}/run`,
    { method: "POST", body: JSON.stringify({ objective }) },
  );
}

export async function listWorkforceRuns(): Promise<{
  items: WorkforceRun[];
  has_more: boolean;
} | null> {
  if (!(await ping())) return null;
  try {
    return await api<{ items: WorkforceRun[]; has_more: boolean }>("/api/workforce/runs?limit=50");
  } catch {
    return null;
  }
}

export async function getWorkforceRun(id: string): Promise<WorkforceRun | null> {
  if (!(await ping())) return null;
  try {
    return await api<WorkforceRun>(`/api/workforce/runs/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

export async function cancelWorkforceRun(id: string): Promise<WorkforceRun | null> {
  if (!(await ping())) return null;
  return await api<WorkforceRun>(`/api/workforce/runs/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
  });
}

export async function reconcileWorkforceRun(
  id: string,
  decision?: string,
): Promise<WorkforceRun | null> {
  if (!(await ping())) return null;
  return await api<WorkforceRun>(`/api/workforce/runs/${encodeURIComponent(id)}/reconcile`, {
    method: "POST",
    body: JSON.stringify({ decision: decision ?? null }),
  });
}

export async function listWorkforceTemplates(): Promise<WorkforceTemplate[] | null> {
  if (!(await ping())) return null;
  try {
    return await api<WorkforceTemplate[]>("/api/workforce/templates");
  } catch {
    return null;
  }
}

// ---------- Knowledge Hub (Fase 2: acervo pessoal de conhecimento) ----------
export type KhLibraryKind = "personal" | "project";
export type KhLibrary = {
  id: string;
  name: string;
  kind: KhLibraryKind;
  description: string;
  created_at?: string;
  updated_at?: string;
};

export type KhNotebook = {
  id: string;
  library_id: string;
  name: string;
  description: string;
  tags: string[];
  source_count: number;
};

export type KhIngestStatus =
  "pending" | "processing" | "indexed" | "partial" | "failed" | "deleted";
export type KhIndexStatus = "pending" | "indexed" | "partial" | "lexical_only";

export type KhSourceVersion = {
  version: number;
  content_hash: string;
  size: number;
  note: string | null;
  created_at: string;
};

export type KhSource = {
  id: string;
  notebook_id: string;
  type: "file" | "url" | "text";
  title: string;
  description: string | null;
  origin: string;
  content_hash: string | null;
  size: number;
  mime: string | null;
  version: number;
  ingest_status: KhIngestStatus;
  index_status: KhIndexStatus;
  error_code: string | null;
  provenance: unknown;
  has_document: boolean;
  versions: KhSourceVersion[];
  created_at: string;
  updated_at: string;
};

export type KhCitation = {
  source_id: string;
  source_title: string;
  document_id: string;
  chunk_id: string;
  chunk_index: number;
  mode: string;
  score: number;
  at: string;
};

export type KhSearchItem = {
  source_id: string;
  source_title: string;
  notebook_id: string;
  document_id: string;
  chunk_id: string;
  chunk_index: number;
  score: number;
  fts_score: number;
  rag_score: number;
  snippet: string;
  content: string;
  citation: KhCitation | null;
};

export type KhSearchResponse = { items: KhSearchItem[]; modes: { fts: boolean; rag: boolean } };
export type KhAskResponse = { answer: string; citations: KhCitation[]; sufficient: boolean };

export type KhTransformOp = "summary" | "topics" | "concepts" | "compare" | "synthesize";
export type KhTransformResult = {
  id: string;
  op: KhTransformOp;
  result: string;
  citations: KhCitation[];
  sources: unknown[];
  created_at: string;
};

export async function listKhLibraries(): Promise<KhLibrary[] | null> {
  if (!(await ping())) return null;
  try {
    return await api<KhLibrary[]>("/api/kh/libraries");
  } catch {
    return null;
  }
}

export async function createKhLibrary(body: {
  name: string;
  kind?: KhLibraryKind;
  description?: string;
}): Promise<KhLibrary | null> {
  if (!(await ping())) return null;
  return await api<KhLibrary>("/api/kh/libraries", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateKhLibrary(
  id: string,
  body: { name?: string; kind?: KhLibraryKind; description?: string },
): Promise<KhLibrary | null> {
  if (!(await ping())) return null;
  return await api<KhLibrary>(`/api/kh/libraries/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteKhLibrary(id: string): Promise<{ ok: boolean } | null> {
  if (!(await ping())) return null;
  return await api<{ ok: boolean }>(`/api/kh/libraries/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function listKhNotebooks(libraryId: string): Promise<KhNotebook[] | null> {
  if (!(await ping())) return null;
  try {
    return await api<KhNotebook[]>(`/api/kh/notebooks?library_id=${encodeURIComponent(libraryId)}`);
  } catch {
    return null;
  }
}

export async function createKhNotebook(body: {
  library_id: string;
  name: string;
  description?: string;
  tags?: string[];
}): Promise<KhNotebook | null> {
  if (!(await ping())) return null;
  return await api<KhNotebook>("/api/kh/notebooks", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteKhNotebook(id: string): Promise<{ ok: boolean } | null> {
  if (!(await ping())) return null;
  return await api<{ ok: boolean }>(`/api/kh/notebooks/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function listKhSources(
  notebookId: string,
): Promise<{ items: KhSource[]; has_more: boolean } | null> {
  if (!(await ping())) return null;
  try {
    return await api<{ items: KhSource[]; has_more: boolean }>(
      `/api/kh/sources?notebook_id=${encodeURIComponent(notebookId)}`,
    );
  } catch {
    return null;
  }
}

/** Fonte do tipo texto (conteúdo digitado/colado vai no corpo JSON). */
export async function createKhSourceText(
  notebookId: string,
  title: string,
  content: string,
): Promise<KhSource | null> {
  if (!(await ping())) return null;
  return await api<KhSource>("/api/kh/sources", {
    method: "POST",
    body: JSON.stringify({ notebook_id: notebookId, type: "text", title, content }),
  });
}

/** Fonte do tipo URL. */
export async function createKhSourceUrl(
  notebookId: string,
  title: string,
  url: string,
): Promise<KhSource | null> {
  if (!(await ping())) return null;
  return await api<KhSource>("/api/kh/sources", {
    method: "POST",
    body: JSON.stringify({ notebook_id: notebookId, type: "url", title, url }),
  });
}

/** Upload de arquivo via multipart (api() não define content-type quando o body é FormData). */
export async function createKhSourceFile(
  notebookId: string,
  title: string,
  file: File,
): Promise<KhSource | null> {
  if (!(await ping())) return null;
  const fd = new FormData();
  fd.append("file", file);
  fd.append("notebook_id", notebookId);
  fd.append("title", title);
  return await api<KhSource>("/api/kh/sources", { method: "POST", body: fd });
}

export async function deleteKhSource(id: string): Promise<{ ok: boolean } | null> {
  if (!(await ping())) return null;
  return await api<{ ok: boolean }>(`/api/kh/sources/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function khSearch(body: {
  query: string;
  notebook_id?: string;
  library_id?: string;
  limit?: number;
}): Promise<KhSearchResponse | null> {
  if (!(await ping())) return null;
  return await api<KhSearchResponse>("/api/kh/search", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function khAsk(body: {
  question: string;
  notebook_id?: string;
  library_id?: string;
}): Promise<KhAskResponse | null> {
  if (!(await ping())) return null;
  return await api<KhAskResponse>("/api/kh/ask", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function khTransform(body: {
  op: KhTransformOp;
  source_ids: string[];
  prompt?: string;
}): Promise<KhTransformResult | null> {
  if (!(await ping())) return null;
  return await api<KhTransformResult>("/api/kh/transform", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ---------- Workflow Studio (Fase 3: workflows duráveis com grafo versionado) ----------
export type WfNodeType =
  | "start"
  | "end"
  | "agent"
  | "tool"
  | "condition"
  | "transform"
  | "knowledge_search"
  | "approval"
  | "wait"
  | "subworkflow";

export type WfGraphNode = {
  id: string;
  type: WfNodeType | string;
  config?: Record<string, unknown>;
};
export type WfGraphEdge = { from: string; to: string; when?: "true" | "false" | string };
export type WfGraph = { nodes: WfGraphNode[]; edges: WfGraphEdge[] };

export type WfDefinition = {
  id: string;
  name: string;
  description: string | null;
  status: "draft" | "published";
  current_version: number;
  allowed_tools: string[];
  created_at: string;
  updated_at: string;
};

export type WfDefinitionVersion = { version: number; created_at: string; graph: WfGraph | null };

export type WfRunStatus =
  | "queued"
  | "running"
  | "waiting_approval"
  | "waiting_dependency"
  | "completed"
  | "failed"
  | "cancelled"
  | "unknown";

export type WfNodeExecution = {
  id: string;
  node_id: string;
  node_type: string;
  status: string;
  attempt: number;
  output: unknown;
  error_code: string | null;
  approval_id: string | null;
  agent_run_id: string | null;
  wake_at: string | null;
};

export type WfRunEvent = {
  id: number;
  at: string;
  kind: string;
  node_id: string | null;
  detail: Record<string, unknown>;
};

export type WfRun = {
  id: string;
  definition_id: string;
  definition_version: number;
  status: WfRunStatus;
  objective: string;
  error_code: string | null;
  budget: Record<string, unknown>;
  usage: Record<string, number>;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  nodes: WfNodeExecution[];
  events: WfRunEvent[];
};

/** Item de listagem: o servidor não inclui nodes/events no índice (só no detalhe). */
export type WfRunSummary = Omit<WfRun, "nodes" | "events">;

export type WfBody = {
  name?: string;
  description?: string;
  allowed_tools?: string[];
  graph?: WfGraph;
};

export async function listWorkflows(): Promise<WfDefinition[] | null> {
  if (!(await ping())) return null;
  try {
    return await api<WfDefinition[]>("/api/workflows");
  } catch {
    return null;
  }
}

export async function createWorkflow(body: WfBody): Promise<WfDefinition | null> {
  if (!(await ping())) return null;
  return await api<WfDefinition>("/api/workflows", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateWorkflow(id: string, body: WfBody): Promise<WfDefinition | null> {
  if (!(await ping())) return null;
  return await api<WfDefinition>(`/api/workflows/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deleteWorkflow(id: string): Promise<{ ok: boolean } | null> {
  if (!(await ping())) return null;
  return await api<{ ok: boolean }>(`/api/workflows/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** Publica a versão de trabalho atual — ela se torna imutável. */
export async function publishWorkflow(id: string): Promise<WfDefinition | null> {
  if (!(await ping())) return null;
  return await api<WfDefinition>(`/api/workflows/${encodeURIComponent(id)}/publish`, {
    method: "POST",
  });
}

export async function listWorkflowVersions(id: string): Promise<WfDefinitionVersion[] | null> {
  if (!(await ping())) return null;
  try {
    return await api<WfDefinitionVersion[]>(`/api/workflows/${encodeURIComponent(id)}/versions`);
  } catch {
    return null;
  }
}

export async function runWorkflow(
  id: string,
  objective: string,
  idempotencyKey?: string,
): Promise<{ run: WfRun; deduplicated: boolean } | null> {
  if (!(await ping())) return null;
  return await api<{ run: WfRun; deduplicated: boolean }>(
    `/api/workflows/${encodeURIComponent(id)}/run`,
    {
      method: "POST",
      body: JSON.stringify({ objective, idempotency_key: idempotencyKey || undefined }),
    },
  );
}

export async function listWorkflowRuns(query?: {
  limit?: number;
  status?: string;
  definition_id?: string;
}): Promise<{ items: WfRunSummary[]; has_more: boolean } | null> {
  if (!(await ping())) return null;
  const params = new URLSearchParams();
  if (query?.limit) params.set("limit", String(query.limit));
  if (query?.status) params.set("status", query.status);
  if (query?.definition_id) params.set("definition_id", query.definition_id);
  const qs = params.toString() ? `?${params.toString()}` : "";
  try {
    return await api<{ items: WfRunSummary[]; has_more: boolean }>(`/api/workflow-runs${qs}`);
  } catch {
    return null;
  }
}

export async function getWorkflowRun(id: string): Promise<WfRun | null> {
  if (!(await ping())) return null;
  try {
    return await api<WfRun>(`/api/workflow-runs/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

export async function cancelWorkflowRun(id: string): Promise<WfRun | null> {
  if (!(await ping())) return null;
  return await api<WfRun>(`/api/workflow-runs/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
  });
}

export async function reconcileWorkflowRun(
  id: string,
): Promise<{ outcome: string; run: WfRun } | null> {
  if (!(await ping())) return null;
  return await api<{ outcome: string; run: WfRun }>(
    `/api/workflow-runs/${encodeURIComponent(id)}/reconcile`,
    { method: "POST" },
  );
}

// ---------- Policy Studio (Fase 3: políticas comportamentais avaliadas no servidor) ----------
export type PolicyScope = "tool" | "workflow" | "agent";
export type PolicyEffect = "allow" | "deny" | "require_approval";
export type PolicyOp = "eq" | "ne" | "in" | "not_in" | "exists";

export type PolicyCondition = { field: string; op: PolicyOp; value?: unknown };

export type Policy = {
  id: string;
  name: string;
  description: string | null;
  version: number;
  priority: number;
  scope: PolicyScope;
  target: string;
  conditions: PolicyCondition[];
  effect: PolicyEffect;
  enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type PolicyBody = {
  name?: string;
  description?: string;
  scope?: PolicyScope;
  target?: string;
  conditions?: PolicyCondition[];
  effect?: PolicyEffect;
  priority?: number;
  enabled?: boolean;
};

export type PolicySimResult = { decision: string; matched: string | null; reason?: string | null };

export async function listPolicies(): Promise<Policy[] | null> {
  if (!(await ping())) return null;
  try {
    return await api<Policy[]>("/api/policies");
  } catch {
    return null;
  }
}

export async function createPolicy(body: PolicyBody): Promise<Policy | null> {
  if (!(await ping())) return null;
  return await api<Policy>("/api/policies", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updatePolicy(id: string, body: PolicyBody): Promise<Policy | null> {
  if (!(await ping())) return null;
  return await api<Policy>(`/api/policies/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export async function deletePolicy(id: string): Promise<{ ok: boolean } | null> {
  if (!(await ping())) return null;
  return await api<{ ok: boolean }>(`/api/policies/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

/** Avalia políticas sobre o contexto informado SEM executar nada — decisão explicada. */
export async function simulatePolicy(body: {
  kind: PolicyScope;
  target: string;
  tool?: string | undefined;
  scope?: string | undefined;
}): Promise<PolicySimResult | null> {
  if (!(await ping())) return null;
  return await api<PolicySimResult>("/api/policies/simulate", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

// ---------- Deep Research (Fase 4: investigações com plano, evidências e relatório) ----------
export type ResearchStatus =
  | "draft"
  | "planning"
  | "running"
  | "waiting"
  | "completed"
  | "partial"
  | "inconclusive"
  | "failed"
  | "unknown";

export type ResearchSource = {
  id: string;
  origin: "web" | "hub" | string;
  title: string;
  url: string | null;
  domain: string | null;
  snippet?: string | null;
  quality: "full" | "partial" | "snippet_only" | "failed" | string;
  fetched_at?: string | null;
};

export type ResearchEvidence = {
  id: string;
  source_id: string;
  quote: string;
  location: string | null;
  type: "direct" | "indirect" | "inference" | "hypothesis" | "gap" | string;
};

export type ResearchClaim = {
  id: string;
  statement: string;
  evidence_ids: string[];
  status: "supported" | "unsupported" | "contested" | "inferred" | string;
};

export type ResearchConflict = {
  id: string;
  claim_a_id: string | null;
  claim_b_id: string | null;
  description: string;
  resolution: string | null;
};

export type ResearchReportSummary = {
  id: string;
  version: number;
  title: string;
  created_at: string;
};

export type ResearchPlan = {
  subquestions: string[];
  strategy: string;
  sufficiency: string;
  kind: "hypothesis" | string;
};

export type ResearchProject = {
  id: string;
  question: string;
  scope_text: string | null;
  status: ResearchStatus;
  plan: ResearchPlan | null;
  sources: ResearchSource[];
  evidence: ResearchEvidence[];
  claims: ResearchClaim[];
  conflicts: ResearchConflict[];
  reports: ResearchReportSummary[];
  created_at: string;
  updated_at: string;
};

export type ResearchReport = {
  version: number;
  title: string;
  content: string;
  citations: {
    n: number;
    source_id: string;
    origin: "web" | "hub" | string;
    title: string;
    url: string | null;
    domain: string | null;
  }[];
};

export async function listResearch(): Promise<{
  items: ResearchProject[];
  has_more: boolean;
} | null> {
  if (!(await ping())) return null;
  try {
    return await api<{ items: ResearchProject[]; has_more: boolean }>("/api/research");
  } catch {
    return null;
  }
}

export async function createResearch(body: {
  question: string;
  scope?: string;
}): Promise<ResearchProject | null> {
  if (!(await ping())) return null;
  return await api<ResearchProject>("/api/research", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getResearch(id: string): Promise<ResearchProject | null> {
  if (!(await ping())) return null;
  return await api<ResearchProject>(`/api/research/${encodeURIComponent(id)}`);
}

export async function planResearch(id: string): Promise<ResearchProject | null> {
  if (!(await ping())) return null;
  return await api<ResearchProject>(`/api/research/${encodeURIComponent(id)}/plan`, {
    method: "POST",
  });
}

export async function executeResearch(id: string): Promise<ResearchProject | null> {
  if (!(await ping())) return null;
  return await api<ResearchProject>(`/api/research/${encodeURIComponent(id)}/execute`, {
    method: "POST",
  });
}

export async function deepenResearch(
  id: string,
  question: string,
): Promise<ResearchProject | null> {
  if (!(await ping())) return null;
  return await api<ResearchProject>(`/api/research/${encodeURIComponent(id)}/deepen`, {
    method: "POST",
    body: JSON.stringify({ question }),
  });
}

export async function getResearchReport(id: string): Promise<ResearchReport | null> {
  if (!(await ping())) return null;
  return await api<ResearchReport>(`/api/research/${encodeURIComponent(id)}/report`);
}

// ---------- Learning Studio (Fase 4: jornadas, tutor, diário e progresso) ----------
export type LearnLesson = {
  id: string;
  title: string;
  content: string;
  references: string[];
  activity_count: number;
};

export type LearnModule = {
  id: string;
  title: string;
  description: string | null;
  lessons: LearnLesson[];
};

export type LearnProject = {
  id: string;
  goal: string;
  level: string | null;
  status: "draft" | "ready" | string;
  sources: string[];
  research_project_id: string | null;
  created_at: string;
  updated_at: string;
};

export type LearnProjectDetail = LearnProject & { modules: LearnModule[] };

export type LearnActivity = {
  id: string;
  lesson_id: string;
  type: string;
  question: string;
  options: string[];
  expected_answer: string | null;
  concept: string | null;
};

export type LearnJournalEntry = { id: string; kind: string; content: string; created_at: string };

export type LearnProgressRow = {
  module: string;
  lessons: {
    lesson: string;
    activities: number;
    attempts: number;
    correct: number;
    incorrect: number;
    undetermined: number;
  }[];
};

export async function listLearning(): Promise<LearnProject[] | null> {
  if (!(await ping())) return null;
  try {
    return await api<LearnProject[]>("/api/learn");
  } catch {
    return null;
  }
}

export async function createLearning(body: {
  goal: string;
  level?: string;
  sourceIds?: string[];
}): Promise<LearnProject | null> {
  if (!(await ping())) return null;
  return await api<LearnProject>("/api/learn", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getLearning(id: string): Promise<LearnProjectDetail | null> {
  if (!(await ping())) return null;
  return await api<LearnProjectDetail>(`/api/learn/${encodeURIComponent(id)}`);
}

export async function generateLearningPath(id: string): Promise<LearnProjectDetail | null> {
  if (!(await ping())) return null;
  return await api<LearnProjectDetail>(`/api/learn/${encodeURIComponent(id)}/path`, {
    method: "POST",
  });
}

export async function tutorAsk(
  id: string,
  body: { question: string; lesson_id?: string },
): Promise<{ answer: string; references: string[] } | null> {
  if (!(await ping())) return null;
  return await api<{ answer: string; references: string[] }>(
    `/api/learn/${encodeURIComponent(id)}/tutor`,
    { method: "POST", body: JSON.stringify(body) },
  );
}

export async function generateLearningActivities(
  lessonId: string,
  count?: number,
): Promise<{ created: number | string[] } | null> {
  if (!(await ping())) return null;
  return await api<{ created: number | string[] }>(
    `/api/learn/lessons/${encodeURIComponent(lessonId)}/activities`,
    { method: "POST", body: JSON.stringify(count ? { count } : {}) },
  );
}

export async function listLearningActivities(lessonId: string): Promise<LearnActivity[] | null> {
  if (!(await ping())) return null;
  return await api<LearnActivity[]>(
    `/api/learn/lessons/${encodeURIComponent(lessonId)}/activities`,
  );
}

export async function submitLearningAttempt(
  activityId: string,
  answer: string,
): Promise<{ correct: boolean | null; feedback: string } | null> {
  if (!(await ping())) return null;
  return await api<{ correct: boolean | null; feedback: string }>(
    `/api/learn/activities/${encodeURIComponent(activityId)}/attempt`,
    { method: "POST", body: JSON.stringify({ answer }) },
  );
}

export async function addJournalEntry(
  id: string,
  body: { kind: string; content: string },
): Promise<LearnJournalEntry | null> {
  if (!(await ping())) return null;
  return await api<LearnJournalEntry>(`/api/learn/${encodeURIComponent(id)}/journal`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function listJournal(id: string): Promise<LearnJournalEntry[] | null> {
  if (!(await ping())) return null;
  return await api<LearnJournalEntry[]>(`/api/learn/${encodeURIComponent(id)}/journal`);
}

export async function getLearningProgress(id: string): Promise<LearnProgressRow[] | null> {
  if (!(await ping())) return null;
  return await api<LearnProgressRow[]>(`/api/learn/${encodeURIComponent(id)}/progress`);
}

// ---------- Computer Studio (Fase 5: sessões de navegador observáveis, planos one-shot
// com verificação e memória procedural — escritas sempre sob aprovação D9) ----------
export type CiSessionStatus = "active" | "closed" | "failed";

/** Item da listagem: sem plans/observations (só no detalhe). */
export type CiSessionSummary = {
  id: string;
  environment: string;
  objective: string;
  status: CiSessionStatus | string;
  created_at: string;
  closed_at: string | null;
};

export type CiObservation = {
  id: string;
  kind: string;
  observation_hash: string;
  dims: Record<string, unknown>;
  artifact_path: string | null;
  created_at: string;
};

/** Passo de plano: alvo e verificação vêm do modelo como objetos (ou string). */
export type CiPlanStep = { action: string; target: unknown; expected: unknown; why: string };

export type CiPlan = {
  id: string;
  objective: string;
  status: string;
  observation_id: string | null;
  created_at: string;
  steps: CiPlanStep[];
};

export type CiSession = CiSessionSummary & {
  config: Record<string, unknown>;
  usage: Record<string, number>;
  plans: CiPlan[];
  observations: CiObservation[];
};

export type CiObserveResult = {
  id: string;
  hash: string;
  dims: Record<string, unknown>;
  content: string;
};

export type CiPlanResult = { plan_id: string; steps: CiPlanStep[] };

/** Execução é parcial por desenho: done / waiting_approval (D9) / replanned / failed_at. */
export type CiExecuteResult = {
  done?: boolean;
  waiting_approval?: boolean;
  replanned?: boolean;
  failed_at?: number | string | null;
};

export type CiProcedure = {
  id: string;
  name: string;
  goal: string;
  status: "observed" | "inferred" | "tested" | "validated" | "deprecated" | string;
  version: number;
  success_count: number;
  fail_count: number;
  steps: CiPlanStep[];
  last_used_at: string | null;
};

export type CiReuseResult = { id: string; steps: CiPlanStep[]; status: string; note: string };

export async function listCiSessions(): Promise<CiSessionSummary[] | null> {
  if (!(await ping())) return null;
  try {
    return await api<CiSessionSummary[]>("/api/ci/sessions");
  } catch {
    return null;
  }
}

export async function openCiSession(body: {
  objective: string;
  environment?: string;
}): Promise<CiSession | null> {
  if (!(await ping())) return null;
  return await api<CiSession>("/api/ci/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getCiSession(id: string): Promise<CiSession | null> {
  if (!(await ping())) return null;
  try {
    return await api<CiSession>(`/api/ci/sessions/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

export async function closeCiSession(id: string): Promise<{ ok: true } | null> {
  if (!(await ping())) return null;
  return await api<{ ok: true }>(`/api/ci/sessions/${encodeURIComponent(id)}/close`, {
    method: "POST",
  });
}

export async function observeCiSession(id: string): Promise<CiObserveResult | null> {
  if (!(await ping())) return null;
  return await api<CiObserveResult>(`/api/ci/sessions/${encodeURIComponent(id)}/observe`, {
    method: "POST",
  });
}

export async function planCiSession(id: string): Promise<CiPlanResult | null> {
  if (!(await ping())) return null;
  return await api<CiPlanResult>(`/api/ci/sessions/${encodeURIComponent(id)}/plan`, {
    method: "POST",
  });
}

export async function executeCiPlan(planId: string): Promise<CiExecuteResult | null> {
  if (!(await ping())) return null;
  return await api<CiExecuteResult>(`/api/ci/plans/${encodeURIComponent(planId)}/execute`, {
    method: "POST",
  });
}

export async function listCiProcedures(): Promise<CiProcedure[] | null> {
  if (!(await ping())) return null;
  try {
    return await api<CiProcedure[]>("/api/ci/procedures");
  } catch {
    return null;
  }
}

export async function createCiProcedure(body: {
  name: string;
  goal: string;
  steps: CiPlanStep[];
  verified?: boolean;
}): Promise<{ id: string; status: string } | null> {
  if (!(await ping())) return null;
  return await api<{ id: string; status: string }>("/api/ci/procedures", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function reuseCiProcedure(id: string): Promise<CiReuseResult | null> {
  if (!(await ping())) return null;
  return await api<CiReuseResult>(`/api/ci/procedures/${encodeURIComponent(id)}/reuse`, {
    method: "POST",
  });
}

// ---------- Multimodal Studio (Fase 6: voz + texto na MESMA conversa via chatExchange;
// captura de microfone explícita; a transcrição é entrada CANDIDATA — só sai da sessão
// com envio confirmado; a fala usa TTS e o áudio NUNCA é persistido) ----------
export type MmSessionStatus = "active" | "closed" | string;

export type MmSessionSummary = {
  id: string;
  conversation_id: string;
  status: MmSessionStatus;
  modalities: string[];
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

/** Metadados da transcrição anexada ao turno (texto + origem: stt/manual/text). */
export type MmTranscript = {
  text: string;
  corrected?: boolean;
  engine?: string;
  language?: string;
  latency_ms?: number;
} | null;

export type MmTurn = {
  id: string;
  session_id: string;
  conversation_id: string;
  seq: number;
  /** idle | listening | transcribing | processing | generating | speaking | interrupted | completed | failed */
  state: string;
  input_kind: "audio" | "text" | string;
  input_text: string | null;
  transcript: MmTranscript;
  reply_message_id: string | null;
  output_text: string | null;
  audio: { type: string; bytes: number; tts_ms?: number } | null;
  error_code: string | null;
  latency: Record<string, number>;
  created_at: string;
  updated_at: string;
};

export type MmEvent = {
  id: number;
  turn_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
  created_at: string;
};

export type MmSession = MmSessionSummary & {
  state: Record<string, unknown>;
  turns: MmTurn[];
  events: MmEvent[];
};

export async function listMmSessions(limit = 50): Promise<MmSessionSummary[] | null> {
  if (!(await ping())) return null;
  try {
    return await api<MmSessionSummary[]>(`/api/mm/sessions?limit=${limit}`);
  } catch {
    return null;
  }
}

export async function openMmSession(body: {
  conversationId: string;
  modalities?: string[];
}): Promise<MmSession | null> {
  if (!(await ping())) return null;
  return await api<MmSession>("/api/mm/sessions", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getMmSession(id: string): Promise<MmSession | null> {
  if (!(await ping())) return null;
  try {
    return await api<MmSession>(`/api/mm/sessions/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

export async function closeMmSession(id: string): Promise<{ ok: true } | null> {
  if (!(await ping())) return null;
  return await api<{ ok: true }>(`/api/mm/sessions/${encodeURIComponent(id)}/close`, {
    method: "POST",
  });
}

/** Cria um turno em escuta no servidor (o microfone em si SÓ é aberto no clique, no cliente). */
export async function startMmCapture(sessionId: string): Promise<MmTurn | null> {
  if (!(await ping())) return null;
  return await api<MmTurn>(`/api/mm/sessions/${encodeURIComponent(sessionId)}/capture/start`, {
    method: "POST",
  });
}

export async function stopMmCapture(turnId: string): Promise<MmTurn | null> {
  if (!(await ping())) return null;
  return await api<MmTurn>(`/api/mm/turns/${encodeURIComponent(turnId)}/capture/stop`, {
    method: "POST",
  });
}

/** Upload de áudio (multipart) → STT; o turno vira transcrição candidata. */
export async function submitMmAudio(
  sessionId: string,
  file: Blob,
  language = "pt",
  filename = "speech.webm",
): Promise<MmTurn | null> {
  if (!(await ping())) return null;
  const fd = new FormData();
  fd.append("file", file, filename);
  fd.append("language", language);
  return await api<MmTurn>(`/api/mm/sessions/${encodeURIComponent(sessionId)}/audio`, {
    method: "POST",
    body: fd,
  });
}

/** Texto direto (digitação): cria turno `idle` com transcrição pronta (ainda NÃO enviada). */
export async function submitMmText(sessionId: string, message: string): Promise<MmTurn | null> {
  if (!(await ping())) return null;
  return await api<MmTurn>(`/api/mm/sessions/${encodeURIComponent(sessionId)}/text`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

/** Correção manual da transcrição (antes do envio). */
export async function updateMmTranscript(turnId: string, text: string): Promise<MmTurn | null> {
  if (!(await ping())) return null;
  return await api<MmTurn>(`/api/mm/turns/${encodeURIComponent(turnId)}/transcript`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

/** Envia a transcrição CONFIRMADA para a conversa (mesmo caminho do chat; resposta persistida). */
export async function sendMmTurn(turnId: string): Promise<MmTurn | null> {
  if (!(await ping())) return null;
  return await api<MmTurn>(`/api/mm/turns/${encodeURIComponent(turnId)}/send`, { method: "POST" });
}

/** Sintetiza a fala da resposta — a resposta é áudio binário (nunca persistido). */
export async function speakMmTurn(turnId: string): Promise<Blob | null> {
  if (!(await ping())) return null;
  return await api<Blob>(`/api/mm/turns/${encodeURIComponent(turnId)}/speak`, { method: "POST" });
}

export async function interruptMmTurn(turnId: string): Promise<MmTurn | null> {
  if (!(await ping())) return null;
  return await api<MmTurn>(`/api/mm/turns/${encodeURIComponent(turnId)}/interrupt`, {
    method: "POST",
  });
}

/** Eventos novos da sessão desde `sinceId` (polling). */
export async function listMmEvents(sessionId: string, sinceId = 0): Promise<MmEvent[] | null> {
  if (!(await ping())) return null;
  try {
    return await api<MmEvent[]>(
      `/api/mm/events?sessionId=${encodeURIComponent(sessionId)}&sinceId=${encodeURIComponent(sinceId)}`,
    );
  } catch {
    return null;
  }
}

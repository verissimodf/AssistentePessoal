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
const setAuth = (s: AuthState) => { authState = s; authListeners.forEach((l) => l(s)); };
export const currentAdmin = () => me;

export async function refreshAuth(): Promise<AuthState> {
  if (!(await ping())) { csrf = null; me = null; setAuth("demo"); return authState; }
  if (setupRequired) { setAuth("setup"); return authState; }
  const r = await fetch(`${bridgeUrl()}/api/auth/me`, { credentials: "include" }).catch(() => null);
  if (r?.ok) { const j = await r.json(); csrf = j.csrf; me = j.admin; setAuth("ok"); }
  else { csrf = null; me = null; setAuth("login"); }
  return authState;
}
export function useAuthState() {
  const [s, setS] = useState<AuthState>(authState);
  useEffect(() => { authListeners.add(setS); refreshAuth(); return () => { authListeners.delete(setS); }; }, []);
  return s;
}
async function authPost(path: string, body: unknown) {
  const r = await fetch(`${bridgeUrl()}${path}`, { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.error || String(r.status)), { code: j.error, retryAfter: j.retryAfter });
  return j;
}
export async function login(username: string, password: string) {
  const j = await authPost("/api/auth/login", { username, password });
  csrf = j.csrf; me = j.admin; setAuth("ok");
}
export async function setupFirstAdmin(token: string, username: string, password: string) {
  await authPost("/api/auth/setup", { token: token.trim(), username, password });
  setupRequired = false;
  await login(username, password);
}
export async function logout() {
  await api("/api/auth/logout", { method: "POST", body: "{}" }).catch(() => undefined);
  csrf = null; me = null; setAuth("login");
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
  if (r.status === 401) { csrf = null; me = null; setAuth(setupRequired ? "setup" : "login"); }
  if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
  const ct = r.headers.get("content-type") || "";
  return (ct.includes("json") ? r.json() : r.blob()) as Promise<T>;
}

// ---------- generic collections (server first, demo fallback) ----------
export type Memory = { id: string; content: string; tags: string; created_at: string };
export type Agent = {
  id: string; name: string; instructions: string; provider: string; model: string;
  tools: string[]; active?: boolean;
};
export type Bot = {
  id: string; name: string; goal: string; agent_id: string;
  trigger_type: "daily" | "interval" | "voice" | "file" | "message"; trigger_value: string;
  autonomy: "confirm" | "safe" | "full"; max_steps: number; enabled: boolean; last_run?: string; scopes?: string[]; owner_admin_id?: string | null;
};
export type Run = { id: string; bot_id: string; started_at: string; status: string; output: string };

const seed: Record<string, unknown[]> = {
  memories: [
    { id: "m1", content: "O usuário prefere respostas curtas e objetivas.", tags: "preferência", created_at: new Date().toISOString() },
    { id: "m2", content: "Reunião semanal da equipe toda segunda às 9h.", tags: "agenda", created_at: new Date().toISOString() },
  ],
  agents: [
    { id: "jarvis", name: "Jarvis", instructions: "Você é J.A.R.V.I.S., assistente pessoal leal, preciso e elegante. Responda no idioma do usuário.", provider: "ollama", model: "llama3.1", tools: ["web_search", "remember", "recall", "run_command"], active: true },
  ],
  bots: [
    { id: "b1", name: "Resumo matinal", goal: "Pesquise as principais notícias de tecnologia e me envie um resumo no Telegram.", agent_id: "jarvis", trigger_type: "daily", trigger_value: "08:00", autonomy: "safe", max_steps: 8, enabled: true },
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
      return q ? items.filter((i) => JSON.stringify(i).toLowerCase().includes(q.toLowerCase())) : items;
    },
    async save(item: Partial<T>): Promise<T> {
      if (online) {
        return item.id
          ? api<T>(`/api/${name}/${item.id}`, { method: "PUT", body: JSON.stringify(item) })
          : api<T>(`/api/${name}`, { method: "POST", body: JSON.stringify(item) });
      }
      const items = demoGet<T>(name);
      const full = { created_at: new Date().toISOString(), ...item, id: item.id || crypto.randomUUID() } as unknown as T;
      const idx = items.findIndex((i) => i.id === full.id);
      if (idx >= 0) items[idx] = { ...items[idx], ...full };
      else items.unshift(full);
      demoSet(name, items);
      return full;
    },
    async remove(id: string) {
      if (online) return api(`/api/${name}/${id}`, { method: "DELETE" });
      demoSet(name, demoGet<T>(name).filter((i) => i.id !== id));
      return undefined;
    },
  };
}

// ---------- settings ----------
export type Settings = { general: any; providers: any; integrations: any; comms: any; voice: any; host: any; [k: string]: any };
export const DEFAULT_SETTINGS: Settings = {
  general: { agentName: "Jarvis", language: "pt" },
  providers: {},
  integrations: {},
  comms: {},
  voice: { tts: "browser", stt: "browser", wake: { clap: true, word: true, hotkey: true, ptt: true }, sensitivity: 6, hotkey: "Ctrl+Shift+J" },
  host: { enabled: false, allowlist: "ls, dir, git status, code ., start, xdg-open" },
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
export type ChatReply = { reply: string; reasoning?: string; tools?: ToolCall[]; pending?: PendingAction[] };
export type ConversationSummary = { id: string; title: string; agent_id?: string | null; created_at: string; updated_at: string };
export type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  meta?: { reasoning?: string; tools?: ToolCall[]; pending?: PendingAction[] } | null;
};
export type ChatExchange = ChatReply & {
  conversation: ConversationSummary | null;
  userMessage?: { id: string; content: string; created_at: string };
  assistantMessageId?: string;
  duplicate?: boolean;
};

/** Conversas do administrador, mais recentes primeiro (vazio no modo demonstração). */
export async function listConversations(): Promise<ConversationSummary[]> {
  if (await ping()) return api<ConversationSummary[]>("/api/conversations");
  return [];
}

/** Uma conversa com as mensagens persistidas (404 se não existir ou não for do usuário). */
export async function openConversation(id: string): Promise<{ conversation: ConversationSummary; messages: ConversationMessage[] }> {
  return api(`/api/conversations/${encodeURIComponent(id)}`);
}

export async function deleteConversation(id: string): Promise<void> {
  if (await ping()) await api(`/api/conversations/${encodeURIComponent(id)}`, { method: "DELETE" });
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
      body: JSON.stringify({ conversationId: conversationId ?? undefined, message, clientMsgId, agentId }),
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
  resumo: { saude: "ok" | "atencao"; total: number; porEstado: Record<string, number>; pendencias: number };
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
export type ExecutionRow = { id: string; approvalId: string | null; kind: string; state: string; exitCode: number | null; verification: string; verifiedBy: string; correlation: string | null; auditId: number | null; at: string };
export type AuditRow = { id: number; at: string; kind: string; detail: string };

/** Aprovações do administrador. `null` = indisponível (offline) — nunca dados de demonstração. */
export async function listApprovals(): Promise<ApprovalRow[] | null> {
  if (await ping()) return (await api<{ approvals: ApprovalRow[] }>("/api/approvals")).approvals;
  return null;
}
/** Ledger de execuções (evidências) do administrador. `null` = indisponível (offline). */
export async function listExecutions(): Promise<ExecutionRow[] | null> {
  if (await ping()) return (await api<{ executions: ExecutionRow[] }>("/api/executions")).executions;
  return null;
}
/** Histórico de auditoria (escopo `audit:read`). `null` = indisponível ou sem permissão. */
export async function loadAudit(): Promise<AuditRow[] | null> {
  if (!(await ping())) return null;
  try { return await api<AuditRow[]>("/api/audit"); } catch { return null; }
}

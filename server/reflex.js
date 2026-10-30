// JEV Reflex — roteador ADVISORY pré-resposta (inspirado em jarvisv7/jev-reflex, adaptado KISS).
//
// Papel: CLASSIFICAR a mensagem antes do cérebro principal (destino, completude, endereçamento,
// necessidade de ação, cobertura) e registrar a decisão na conversa (meta.reflex), para o painel
// mostrar custo/latência e a intenção interpretada. NUNCA gatilha, bloqueia ou autoriza nada:
// permanece 100% advisory — uma resposta de LLM não é prova de ação (ver docs/EXECUCAO-VERIFICAVEL).
//
// Ativação: opt-in por administrador (Configurações → Preferências → reflex.enabled). Off = baixo
// custo zero (nenhuma chamada extra). Em falha do roteador (timeout/JSON inválido/provedor morto),
// o chat continua normalmente com fonte "fallback" explicitamente identificada.
//
// Local-first: usa o provedor "ollama" configurado do próprio administrador. Timeout de 8 s,
// sem retries (contenção de custo), stream:false explícito (gateways SSE compatíveis com OpenAI).
import { getSettings, DEFAULT_OLLAMA_MODEL } from "./settings.js";
import { providerConfig } from "./llm.js";

export const REFLEX_TIMEOUT_MS = 8000;
export const REFLEX_ROUTES = ["vault", "communication", "task", "general", "insufficient"];

const REFLEX_SYSTEM =
  "Você é um roteador JEV pré-resposta. Responda SOMENTE com JSON compacto: " +
  '{"route":"vault|communication|task|general|insufficient",' +
  '"complete":true,"addressed":true,"action":false,"coverage":"<até 240 caracteres>",' +
  '"confidence":0.86}. ' +
  "route: vault=pedido sobre memórias/gerência de notas; communication=mensagem/envio por canal; " +
  "task=tarefa/acão com ferramentas nesta sessão; general=pergunta para o cérebro principal; " +
  "insufficient=faltam informações para agir. complete=se o pedido está completo em uma frase; " +
  "addressed=se é dirigido ao assistente (não a outro sistema); action=se pede ação executável; " +
  "coverage=se memórias/notas já cobrem o necessário (resumo). confidence=confiança na ROTA.";

/** Configuração efetiva por administrador (nada sensível; fica no painel). */
export function reflexConfig(adminId) {
  const s = getSettings(adminId);
  const r = s.reflex && typeof s.reflex === "object" ? s.reflex : {};
  const cfg = providerConfig("ollama", adminId);
  return {
    enabled: r.enabled === true,
    model: String(r.model || "").trim() || cfg.model || DEFAULT_OLLAMA_MODEL,
    threshold: Math.min(0.99, Math.max(0.5, Number(r.threshold) || 0.8)),
    baseUrl: cfg.baseUrl,
  };
}

const STATUS_LATENCY = (startedAt) => Math.max(0, Date.now() - startedAt);

/** Parse tolerante da resposta: primeiro objeto {...}; rota inválida/ausente → null. */
export function parseReflexReply(text) {
  const m = /\{[\s\S]*\}/.exec(String(text || ""));
  if (!m) return null;
  let j;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!j || typeof j !== "object" || Array.isArray(j)) return null;
  const route = String(j.route || "");
  if (!REFLEX_ROUTES.includes(route)) return null;
  const num = (v, d0, d1, dflt) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(d1, Math.max(d0, n)) : dflt;
  };
  const bool = (v) => (typeof v === "boolean" ? v : null);
  const cap = (s, n) => String(s ?? "").slice(0, n);
  return {
    route: cap(route, 16),
    complete: bool(j.complete),
    addressed: bool(j.addressed),
    action: bool(j.action),
    coverage: j.coverage === undefined || j.coverage === null ? null : cap(j.coverage, 240),
    confidence: num(j.confidence, 0, 1, 0),
  };
}

/**
 * Avalia o Reflex para UMA mensagem. Retornos:
 *  - null            → desativado/mensagem pequena (nenhuma chamada, nenhum evento);
 *  - { source:"jev", route, confidence, ... }  → decisão estruturada;
 *  - { source:"fallback", reason, ... }        → falha explícita, chat segue normal.
 */
export async function evaluateReflex(
  adminId,
  message,
  { fetchFn = (...a) => globalThis.fetch(...a) } = {},
) {
  const { enabled, model, threshold, baseUrl } = reflexConfig(adminId);
  if (!enabled) return null;
  if (typeof message !== "string" || message.trim().length < 8) return null;
  const startedAt = Date.now();
  try {
    const r = await fetchFn(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model,
        stream: false, // mesma guarda de callOpenAI: gateways SSE quebram r.json()
        messages: [
          { role: "system", content: REFLEX_SYSTEM },
          { role: "user", content: message.slice(0, 4000) },
        ],
      }),
      signal: AbortSignal.timeout(REFLEX_TIMEOUT_MS),
    });
    if (!r.ok) {
      return {
        source: "fallback",
        reason: `http_${r.status}`,
        latencyMs: STATUS_LATENCY(startedAt),
        model,
        threshold,
      };
    }
    const j = await r.json().catch(() => null);
    const parsed = parseReflexReply(j?.choices?.[0]?.message?.content);
    if (!parsed)
      return {
        source: "fallback",
        reason: "invalid_reply",
        latencyMs: STATUS_LATENCY(startedAt),
        model,
        threshold,
      };
    return { source: "jev", latencyMs: STATUS_LATENCY(startedAt), model, threshold, ...parsed };
  } catch (e) {
    const timedOut = e?.name === "TimeoutError" || /abort/i.test(String(e?.name));
    return {
      source: "fallback",
      reason: timedOut ? "timeout" : "provider_error",
      latencyMs: STATUS_LATENCY(startedAt),
      model,
      threshold,
    };
  }
}

// Abstração de integração HTTP para integrações `kind: "http"` (Odysseus, OpenClaw, OpenWebUI…).
//
// Por que existe: `cli_agent` executa `cfg.command` como comando de shell e só funciona para
// `kind: "cli"`. Integrações HTTP não têm consumidor — é o caso do Odysseus (UI em
// `http://odysseus-odysseus-1:7000`), que aparece como configurado mas é inalcançável pelo agente.
//
// Regras de segurança (nada aqui concede capacidade por si só):
//  - **Allowlist**: só ids existentes em `integrations` com `kind: "http"` e `enabled: true`.
//    A URL vem da configuração do administrador; não há parâmetro de URL na chamada.
//  - **Autenticação**: `Bearer` do `apiKey` configurado, nunca de argumento.
//  - **Timeout** por chamada e limite de bytes na resposta.
//  - **Validação de entrada**: id restrito, prompt com tamanho máximo.
//  - **Validação de saída**: JSON, formato OpenAI-compatible (`choices[0].message.content`),
//    texto truncado; nada de repassar payload cru.
//  - **Auditoria**: apenas ids e códigos de estado (nunca prompt ou resposta).
//
// A URL da integração é interna por natureza (DNS de serviço). A política SSRF de `assertSafeUrl`
// NÃO se aplica aqui: o destino é escolhido pelo administrador na configuração, não pelo modelo.
import { getSettings } from "./settings.js";
import { audit as auditDb } from "./db.js";

export const HTTP_AGENT_TIMEOUT_MS = 30_000;
export const HTTP_AGENT_MAX_PROMPT = 8_000;
export const HTTP_AGENT_MAX_OUTPUT = 8_000;

export class HttpIntegrationError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = "HttpIntegrationError";
    this.code = code;
  }
}

/** Resolve uma integração HTTP habilitada da configuração (allowlist). */
export function resolveHttpIntegration(id, settings) {
  const alvo = String(id ?? "").trim();
  if (!alvo || alvo.length > 64 || !/^[a-z0-9_-]+$/i.test(alvo)) {
    throw new HttpIntegrationError("invalid_integration", "Integração inválida.");
  }
  const cfg = (settings || getSettings())?.integrations?.[alvo];
  if (!cfg || typeof cfg !== "object") {
    throw new HttpIntegrationError("unknown_integration", `Integração "${alvo}" não configurada.`);
  }
  if (cfg.kind !== "http") {
    throw new HttpIntegrationError("wrong_kind", `Integração "${alvo}" não é do tipo http.`);
  }
  if (!cfg.enabled) {
    throw new HttpIntegrationError("integration_disabled", `Integração "${alvo}" desabilitada.`);
  }
  const base = String(cfg.command || "").replace(/\/$/, "");
  let url;
  try {
    url = new URL(base);
  } catch {
    throw new HttpIntegrationError(
      "invalid_integration_url",
      `Integração "${alvo}" sem URL válida.`,
    );
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new HttpIntegrationError(
      "invalid_integration_url",
      `Integração "${alvo}" com esquema não suportado.`,
    );
  }
  return { id: alvo, baseUrl: base, apiKey: cfg.apiKey || "", kind: cfg.kind };
}

/** Extrai texto de uma resposta OpenAI-compatible, com limite e sem repassar o payload cru. */
export function extractText(payload, maxChars = HTTP_AGENT_MAX_OUTPUT) {
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content === "string") return content.slice(0, maxChars);
  if (Array.isArray(content)) {
    const juntar = content
      .map((p) => (typeof p === "string" ? p : typeof p?.text === "string" ? p.text : ""))
      .join("")
      .trim();
    if (juntar) return juntar.slice(0, maxChars);
  }
  throw new HttpIntegrationError(
    "invalid_response",
    "Resposta da integração em formato inesperado.",
  );
}

/**
 * Chama uma integração HTTP com contrato OpenAI (`POST {base}/chat/completions`).
 * Erros são tipados por `code`; nunca incluem prompt, chave ou corpo bruto da resposta.
 */
export async function callHttpIntegration(
  id,
  {
    prompt,
    settings,
    fetchImpl = (...a) => globalThis.fetch(...a),
    timeoutMs = HTTP_AGENT_TIMEOUT_MS,
    audit = auditDb,
  } = {},
) {
  const integracao = resolveHttpIntegration(id, settings);

  const texto = typeof prompt === "string" ? prompt : "";
  if (!texto.trim()) throw new HttpIntegrationError("empty_prompt", "Prompt vazio.");
  if (texto.length > HTTP_AGENT_MAX_PROMPT) {
    throw new HttpIntegrationError(
      "prompt_too_long",
      `Prompt acima de ${HTTP_AGENT_MAX_PROMPT} caracteres.`,
    );
  }

  const signal = AbortSignal.timeout(timeoutMs);
  let resposta;
  try {
    resposta = await fetchImpl(`${integracao.baseUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers: {
        "content-type": "application/json",
        ...(integracao.apiKey ? { authorization: `Bearer ${integracao.apiKey}` } : {}),
      },
      body: JSON.stringify({
        messages: [{ role: "user", content: texto }],
        stream: false,
      }),
    });
  } catch (e) {
    const code = e?.name === "TimeoutError" ? "timeout" : "unreachable";
    audit("http_agent(failed)", { tool: "http_agent", reason: code, agent: integracao.id });
    throw new HttpIntegrationError(
      code,
      code === "timeout" ? "Tempo esgotado ao falar com a integração." : "Integração inacessível.",
    );
  }

  if (!resposta.ok) {
    audit("http_agent(failed)", {
      tool: "http_agent",
      reason: "upstream_error",
      agent: integracao.id,
      status: String(resposta.status),
    });
    throw new HttpIntegrationError("upstream_error", `Integração respondeu ${resposta.status}.`);
  }

  let payload;
  try {
    payload = await resposta.json();
  } catch {
    audit("http_agent(failed)", {
      tool: "http_agent",
      reason: "invalid_response",
      agent: integracao.id,
    });
    throw new HttpIntegrationError("invalid_response", "Resposta da integração não é JSON.");
  }

  const conteudo = extractText(payload);
  audit("http_agent(done)", { tool: "http_agent", status: "done", agent: integracao.id });
  return { agent: integracao.id, text: conteudo };
}

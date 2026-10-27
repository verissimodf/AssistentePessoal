// Integração AgentMail (https://agentmail.to) — e-mail API-first para agentes, no lado do SERVIÇO.
//
// Propriedades de segurança (seguem as regras do repo — ver AGENTS.md):
//  - Segredos (API key, segredo do webhook) vêm SOMENTE do servidor de configuração
//    (`global_settings.integrations.agentmail`) e, como fallback operacional, do ambiente
//    (AGENTMAIL_API_KEY / AGENTMAIL_WEBHOOK_SECRET / AGENTMAIL_INBOX_ID). Nunca são logados,
//    retornados pelo painel ou embutidos em mensagens de erro.
//  - Recebimento (webhook `message.received`) usa o envelope Svix: verificação HMAC-SHA256
//    implementada com node:crypto (sem dependência nova), janela de tolerância e comparação
//    em tempo constante. Corpo é mantido em BRUTO (Buffer) até passar na verificação.
//  - Persistimos apenas METADADOS do envelope (de, assunto, ids) — nunca o conteúdo do corpo;
//    leitura de conteúdo é on-demand pela API, sempre sob escopo `comms:read`.
//  - Todo conteúdo de e-mail é DADO NÃO CONFIÁVEL: nunca serve de instrução (regra do repo).
//  - Envio por agente segue o D9 (como send_email IMAP): a ferramenta só ENFILEIRA uma
//    aprovação humana; o envio real acontece em `resolveApproval`, com revalidação de
//    configuração e de impressão digital no momento da aprovação.
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { db, now, audit } from "./db.js";
import { getSettings } from "./settings.js";
import { ClaimError, ownerOf, owns, tx } from "./ownership.js";

/** Endpoint REST oficial (v0). Fixo: nunca configurável — evita exfiltração da API key para host arbitrário. */
export const AGENTMAIL_BASE_URL = "https://api.agentmail.to/v0";

/** Janela Svix padrão: 5 minutos (espelha a biblioteca oficial; anti-replay). */
export const SVIX_TOLERANCE_MS = 5 * 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

/** Instável e sem conteúdo: única forma de reportar falha sem vazar credencial ou provedor. */
export class AgentMailError extends Error {
  constructor(status, code) {
    super(code);
    this.name = "AgentMailError";
    this.status = status;
    this.code = code;
  }
}

/**
 * Configuração efetiva: global_settings.integrations.agentmail prevalece; ambiente entra como
 * fallback operacional (nunca o contrário). `enabled` é exclusivamente um ato administrativo
 * consciente no painel — a existência da chave no env NÃO ativa a integração.
 */
export function agentMailConfig(env = process.env, settings = getSettings()) {
  const cfg = settings?.integrations?.agentmail || {};
  const apiKey = String(cfg.apiKey || env.AGENTMAIL_API_KEY || "");
  return {
    enabled: !!cfg.enabled,
    apiKey,
    webhookSecret: String(cfg.webhookSecret || env.AGENTMAIL_WEBHOOK_SECRET || ""),
    inboxId: String(cfg.inboxId || env.AGENTMAIL_INBOX_ID || ""),
    webhookId: String(cfg.webhookId || ""),
  };
}

// ---------- webhook (Svix) ----------

/**
 * Verificação Svix manual (https://docs.svix.com):
 *   signedContent = "{svix-id}.{svix-timestamp}.{corpo bruto}"
 *   assinatura    = "v1,{base64(HMAC-SHA256(chave, signedContent))}"
 * A chave é a parte após "whsec_" (base64). Comparações em tempo constante; rejeita assinaturas
 * adicionais, timestamp fora da janela (retardo E adiantamento) e header ausente.
 */
export function verifySvixSignature(
  rawBody,
  headers,
  secret,
  { now: nowMs = Date.now(), toleranceMs = SVIX_TOLERANCE_MS } = {},
) {
  let key = null;
  if (typeof secret === "string") {
    try {
      key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    } catch {
      key = null;
    }
  }
  if (!key?.length) return false;

  const id = headers?.["svix-id"] != null ? String(headers["svix-id"]) : "";
  const tsRaw = headers?.["svix-timestamp"] != null ? String(headers["svix-timestamp"]) : "";
  const sigRaw = headers?.["svix-signature"] != null ? String(headers["svix-signature"]) : "";
  if (!id || !tsRaw || !sigRaw) return false;
  const ts = Number(tsRaw);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(nowMs - ts * 1000) > toleranceMs) return false;

  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ""), "utf8");
  const content = `${id}.${tsRaw}.${payload.toString("utf8")}`;
  let computed;
  try {
    computed = createHmac("sha256", key).update(content, "utf8").digest("base64");
  } catch {
    return false;
  }
  const expected = Buffer.from(`v1,${computed}`, "utf8");
  return sigRaw
    .split(/\s+/)
    .filter(Boolean)
    .some((sig) => {
      try {
        return timingSafeEqual(Buffer.from(sig, "utf8"), expected);
      } catch {
        return false; // tamanhos distintos → timingSafeEqual joga; assinatura incompatível
      }
    });
}

/**
 * Persiste o evento verificado com deduplicação pelo `svix-id` (a entrega repete o mesmo id nos
 * retries). Só metadados — o corpo do e-mail jamais chega ao banco.
 * Retorna true SOMENTE na primeira gravação; duplicatas deixam de reagir (sem reprocesso).
 */
export function insertAgentMailEvent(evt) {
  const r = db
    .prepare(
      `INSERT INTO agentmail_events (svix_id, event_type, event_id, inbox_id, thread_id, message_id, from_addr, subject, to_addr, received_at, processed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(svix_id) DO NOTHING`,
    )
    .run(
      String(evt?.svixId ?? ""),
      String(evt?.eventType ?? ""),
      String(evt?.eventId ?? ""),
      String(evt?.inboxId ?? ""),
      String(evt?.threadId ?? ""),
      String(evt?.messageId ?? ""),
      String(evt?.from ?? ""),
      String(evt?.subject ?? ""),
      String(Array.isArray(evt?.to) ? evt.to.filter((x) => typeof x === "string").join(", ") : ""),
      String(evt?.receivedAt ?? ""),
      now(),
    );
  return r.changes > 0;
}

/** Histórico de eventos (somente leitura, metadados). Para o painel/agente triagarem chegada. */
export function listAgentMailEvents({ adminId = "", limit = 50 } = {}) {
  const rows = db
    .prepare(
      `SELECT svix_id, event_type, inbox_id, thread_id, message_id, subject, received_at, processed_at
       FROM agentmail_events e
       JOIN ownership o ON o.resource_type = 'agentmail_inbox'
         AND o.resource_id = e.inbox_id AND o.owner_admin_id = ?
       ORDER BY processed_at DESC LIMIT ?`,
    )
    .all(String(adminId), Math.max(1, Math.min(Number(limit) || 50, 200)));
  return rows;
}

/** Explicitly claim the configured organization inbox; historical resources are never assigned on boot. */
export function claimAgentMailInbox(adminId, { confirm } = {}) {
  if (!adminId) throw new ClaimError(403, "admin_session_required");
  if (confirm !== "ASSUMIR") throw new ClaimError(400, "confirmation_required");
  const cfg = agentMailConfig(process.env, getSettings(adminId));
  const inboxId = cfg.inboxId.trim();
  if (!cfg.enabled || !cfg.apiKey || !inboxId)
    throw new ClaimError(400, "integration_missing_inbox");
  const owner = ownerOf("agentmail_inbox", inboxId);
  if (owner && owner !== adminId) throw new ClaimError(409, "already_owned");
  if (owner === adminId) return { ok: true, inboxId, alreadyOwned: true };
  return tx(() => {
    // Recheck inside the write transaction to prevent concurrent claims.
    const currentOwner = ownerOf("agentmail_inbox", inboxId);
    if (currentOwner) throw new ClaimError(409, "already_owned");
    db.prepare("INSERT INTO agentmail_inboxes (id, created_at) VALUES (?, ?)").run(inboxId, now());
    db.prepare(
      "INSERT INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin) VALUES ('agentmail_inbox', ?, ?, ?, 'claimed')",
    ).run(inboxId, adminId, now());
    db.prepare(
      "INSERT INTO legacy_claims (resource_type, resource_id, admin_id, at) VALUES ('agentmail_inbox', ?, ?, ?)",
    ).run(inboxId, adminId, now());
    audit("agentmail_inbox.claimed", { admin: adminId, type: "agentmail_inbox", count: 1 });
    return { ok: true, inboxId, alreadyOwned: false };
  });
}

// ---------- cliente REST (fixo em api.agentmail.to; Bearer; timeout; sem vazar segredo) ----------

/**
 * Fábrica do cliente. `fetchImpl` é injetável (sem socket nos testes de contrato). Nunca devolve
 * ou loga a chave; erros carregam apenas status + código estável.
 */
export function createAgentMailClient(
  cfg,
  { fetchImpl = fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {},
) {
  const call = async (path, { method = "GET", body } = {}) => {
    if (!cfg?.apiKey) throw new AgentMailError(401, "agentmail_not_configured");
    let res;
    try {
      res = await fetchImpl(`${AGENTMAIL_BASE_URL}${path}`, {
        method,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${cfg.apiKey}`,
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new AgentMailError(502, "agentmail_unreachable");
    }
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null; // corpo malformado → sem comprovação, idem comms.js
    }
    if (!res.ok) {
      throw new AgentMailError(
        res.status,
        res.status === 401 || res.status === 403 ? "agentmail_auth_error" : "agentmail_api_error",
      );
    }
    return json;
  };

  const inboxPath = (inboxId) =>
    `/inboxes/${encodeURIComponent(String(inboxId ?? cfg.inboxId ?? ""))}`;
  return {
    kind: "agentmail",
    listInboxes: () => call("/inboxes"),
    listMessages: (inboxId, { limit = 10 } = {}) =>
      call(`${inboxPath(inboxId)}/messages?limit=${encodeURIComponent(String(limit))}`),
    getMessage: (inboxId, messageId) =>
      call(`${inboxPath(inboxId)}/messages/${encodeURIComponent(String(messageId))}`),
    sendMessage: (inboxId, { to, subject, text, html } = {}) =>
      call(`${inboxPath(inboxId)}/messages/send`, {
        method: "POST",
        body: {
          to: Array.isArray(to) ? to : [to],
          subject: String(subject ?? ""),
          ...(html ? { html: String(html) } : { text: String(text ?? "") }),
        },
      }),
    createWebhook: (url, eventTypes = ["message.received"]) =>
      call("/webhooks", { method: "POST", body: { url: String(url), event_types: eventTypes } }),
    listWebhooks: () => call("/webhooks"),
    deleteWebhook: (webhookId) =>
      call(`/webhooks/${encodeURIComponent(String(webhookId))}`, { method: "DELETE" }),
  };
}

// ---------- porta de execução (envio real só após aprovação humana) ----------

/** Impressão digital estável de (inbox, destinatário, assunto, corpo): prende a aprovação ao conteúdo. */
export function agentMailSendFingerprint({ inboxId, to, subject, text }) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        String(inboxId ?? ""),
        String(to ?? ""),
        String(subject ?? ""),
        String(text ?? ""),
      ]),
    )
    .digest("hex")
    .slice(0, 32);
}

/**
 * Gate do envio (mesma semântica de describeSend em comms.js). Revalidado na fila E novamente no
 * momento da aprovação — configuração que muda entre os dois passos invalida o envio.
 */
export function describeAgentMailSend(adminId, { to, subject, text } = {}, settings = undefined) {
  if (!adminId) return { ok: false, reason: "Sem proprietário válido: envio bloqueado." };
  const cfg = agentMailConfig(process.env, settings ?? getSettings(adminId));
  if (!cfg.enabled || !cfg.apiKey)
    return { ok: false, reason: 'Integração "agentmail" não está habilitada em Configurações.' };
  if (!cfg.inboxId || !owns(adminId, "agentmail_inbox", cfg.inboxId))
    return { ok: false, reason: "Caixa AgentMail não reivindicada por este administrador." };
  const dest = String(to ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(dest))
    return { ok: false, reason: "Destinatário inválido." };
  const subjectStr = String(subject ?? "").trim();
  if (!subjectStr) return { ok: false, reason: "Assunto vazio." };
  return {
    ok: true,
    inboxId: cfg.inboxId,
    to: dest,
    subject: subjectStr,
    text: String(text ?? ""),
  };
}

/**
 * Executor invocado SOMENTE por resolveApproval (com aprovação humana). Revalida gate +
 * impressão digital; nunca devolve segredo ou conteúdo — só metadados do verificador
 * (provider_message_id, como comms.js).
 */
export async function sendAgentMailApproved(adminId, action, expect, { clientFactory } = {}) {
  const d = describeAgentMailSend(adminId, {
    to: action?.to,
    subject: action?.subject,
    text: action?.text,
  });
  if (!d.ok) return { output: d.reason };
  if (
    !action?.inboxId ||
    action.inboxId !== agentMailConfig(process.env, getSettings(adminId)).inboxId
  )
    return { output: "Envio cancelado: a caixa mudou desde a aprovação." };
  if (
    expect &&
    agentMailSendFingerprint({
      inboxId: action.inboxId,
      to: d.to,
      subject: d.subject,
      text: d.text,
    }) !== expect
  )
    return { output: "Envio cancelado: o destinatário/assunto/corpo mudou desde a aprovação." };
  audit("send_email(agentmail)", { account: "agentmail", status: "started" });
  const client = (clientFactory ?? defaultClientFactory)();
  const res = await client.sendMessage(d.inboxId, { to: d.to, subject: d.subject, text: d.text });
  const id = res?.message_id ?? res?.messageId;
  return {
    output: id ? "Enviado via AgentMail." : "AgentMail não retornou identificador de mensagem.",
    verify: id
      ? { verifier: "provider_message_id", ok: true }
      : { verifier: "contract_text", ok: false },
  };
}

/** Seam de teste (espelha setMailTransport em mail-service.js): sem rede nos testes de contrato. */
let clientFactory = null;
export function setAgentMailClientFactory(fn) {
  clientFactory = fn;
}
function defaultClientFactory() {
  return clientFactory
    ? clientFactory(agentMailConfig())
    : createAgentMailClient(agentMailConfig());
}
/** Cliente para leituras administrativas e ferramentas (usa a config efetiva atual). */
export function getAgentMailClient() {
  return defaultClientFactory();
}

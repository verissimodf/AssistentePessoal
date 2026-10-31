// Integration Fabric — evolução Fase 8 (docs/evolution/phase-8).
// Registro central de integrações + webhook ingress autenticado (HMAC-SHA256, janela de
// tempo, replay protection, rate limit) + contrato canônico de eventos externos +
// CalendarProvider abstrato (sincronização incremental com cursores, dedupe, conflitos).
//
// Invariantes (§15): evento externo é DADO NÃO CONFIÁVEL — nunca instrução; a assinatura
// AUTENTICA o produtor mas não autoriza ação alguma; identidade vem da credencial
// validada no backend (o payload NUNCA se declara confiável); toda execução proativa
// segue pelo Proactive Engine → Workflow Engine → Policy Engine/D9. Sem segredos em logs.
import { parseJson, clean } from "./util.js";
import { db, now, uid, audit } from "./db.js";
import { assignNew, owns, tx } from "./ownership.js";
import { encrypt, decrypt } from "./secret-crypto.js";
import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { getCalendarProvider } from "./calendar.js"; // registry de adapters (sem ciclo)

export const IF_LIMITS = {
  max_integrations_per_owner: 20,
  max_producers_per_integration: 10,
  max_payload_bytes: 256 * 1024,
  max_clock_skew_ms: 5 * 60 * 1000,
  max_events_per_minute: 30, // por produtor
  max_events_per_owner: 2000, // retenção de eventos externos
  max_batch_events: 25,
  max_sync_events: 500,
};

export const ADAPTERS = {
  webhook: {
    capabilities: ["receive_events"],
    description: "Ingress de webhooks autenticados por HMAC-SHA256",
  },
  calendar: {
    capabilities: ["list_calendars", "list_events", "sync", "conflicts"],
    description: "Sincronização de calendários (provider abstrato)",
  },
};

export class IfError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = "IfError";
    this.code = code;
  }
}

// ---------- integrações ----------

const integrationView = (r) => ({
  ...r,
  capabilities: parseJson(r.capabilities_json, []),
  config: parseJson(r.config_json, {}),
  policy: parseJson(r.policy_json, {}),
  health: parseJson(r.health_json, {}),
});

export function createIntegration(adminId, { kind, adapter, name, config = {}, policy = {} } = {}) {
  if (!adminId) throw new IfError("if_owner_required");
  if (!ADAPTERS[kind]) throw new IfError("if_invalid_kind");
  const n = clean(name, 80).trim();
  if (!n) throw new IfError("if_name_required");
  const count = db
    .prepare("SELECT COUNT(*) c FROM if_integrations WHERE owner_admin_id = ?")
    .get(adminId).c;
  if (count >= IF_LIMITS.max_integrations_per_owner) throw new IfError("if_integration_limit");
  const cfg = validateConfig(kind, adapter, config);
  const id = uid();
  const ts = now();
  tx(() => {
    db.prepare(
      "INSERT INTO if_integrations (id, owner_admin_id, kind, adapter, name, version, capabilities_json, config_json, policy_json, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,'configured',?,?)",
    ).run(
      id,
      adminId,
      kind,
      clean(adapter, 40),
      n,
      "1",
      JSON.stringify(ADAPTERS[kind].capabilities),
      JSON.stringify(cfg),
      JSON.stringify(policy ?? {}),
      ts,
      ts,
    );
    assignNew("if_integration", id, adminId);
  });
  audit("if.integration_created", { admin: adminId, ids: [id], type: kind });
  return getIntegration(adminId, id);
}

function validateConfig(kind, adapter, config) {
  if (!config || typeof config !== "object" || Array.isArray(config))
    throw new IfError("if_invalid_config");
  if (kind === "calendar" && !getCalendarProvider(adapter || "fixture"))
    throw new IfError("if_unknown_adapter");
  // config aceitável: strings curtas/booleanos — validação por adaptador acontece na ativação
  const out = {};
  for (const [k, v] of Object.entries(config).slice(0, 20)) {
    if (typeof v === "string") out[clean(k, 40)] = clean(v, 200);
    else if (typeof v === "boolean" || typeof v === "number") out[clean(k, 40)] = v;
  }
  return out;
}

export function getIntegration(adminId, id) {
  if (!owns(adminId, "if_integration", id)) return null;
  const r = db.prepare("SELECT * FROM if_integrations WHERE id = ?").get(String(id));
  if (!r) return null;
  return {
    ...integrationView(r),
    producers: listProducers(adminId, id),
    accounts:
      r.kind === "calendar"
        ? db
            .prepare(
              "SELECT id, provider, provider_account, status, sync_cursor, last_sync_at, last_error FROM cal_accounts WHERE integration_id = ?",
            )
            .all(id)
        : [],
  };
}

export function listIntegrations(adminId) {
  if (!adminId) return [];
  return db
    .prepare("SELECT * FROM if_integrations WHERE owner_admin_id = ? ORDER BY created_at DESC")
    .all(adminId)
    .map(integrationView);
}

export function setIntegrationState(adminId, id, status, { lastError = null } = {}) {
  if (!["unconfigured", "configured", "active", "degraded", "disabled", "error"].includes(status))
    throw new IfError("if_invalid_status");
  const r = db.prepare("SELECT status FROM if_integrations WHERE id = ?").get(String(id));
  if (!r || !owns(adminId, "if_integration", id)) return { error: "not_found" };
  db.prepare(
    "UPDATE if_integrations SET status = ?, last_error = COALESCE(?, last_error), updated_at = ? WHERE id = ?",
  ).run(status, lastError ? clean(lastError, 200) : null, now(), id);
  audit("if.integration_state", { admin: adminId, ids: [id], status });
  return getIntegration(adminId, id);
}

/** Desativação individual: integração desligada NÃO processa eventos (testado). */
export function deactivateIntegration(adminId, id) {
  const out = setIntegrationState(adminId, id, "disabled");
  if (out.error) return out;
  db.prepare(
    "UPDATE if_producers SET disabled_at = COALESCE(disabled_at, ?) WHERE integration_id = ?",
  ).run(now(), id);
  if (out.kind === "calendar")
    db.prepare(
      "UPDATE cal_accounts SET status = 'disabled', updated_at = ? WHERE integration_id = ?",
    ).run(now(), id);
  return out;
}

/** Teste de conectividade/saúde por adaptador (sem segredos na resposta). */
export function checkIntegration(adminId, id) {
  const r = db.prepare("SELECT * FROM if_integrations WHERE id = ?").get(String(id));
  if (!r || !owns(adminId, "if_integration", id)) return { error: "not_found" };
  const v = integrationView(r);
  const at = now();
  let health = { ...v.health, checked_at: at, ok: false };
  if (v.kind === "calendar") {
    const provider = getCalendarProvider(r.adapter);
    const res = provider?.healthCheck?.(v) || { ok: false, error: "if_unknown_adapter" };
    health = { ...health, ...res };
  } else if (v.kind === "webhook") {
    const producers = db
      .prepare(
        "SELECT COUNT(*) c FROM if_producers WHERE integration_id = ? AND disabled_at IS NULL",
      )
      .get(id).c;
    health = { ...health, ok: producers > 0, producers };
  }
  db.prepare(
    "UPDATE if_integrations SET health_json = ?, last_contact_at = ?, status = ?, updated_at = ? WHERE id = ?",
  ).run(
    JSON.stringify(health),
    at,
    health.ok ? "active" : v.status === "active" ? "degraded" : v.status,
    at,
    id,
  );
  return getIntegration(adminId, id);
}

// ---------- produtores de webhook (HMAC) ----------

export function createProducer(adminId, integrationId, { name, allowedEventTypes = [] } = {}) {
  const it = db.prepare("SELECT * FROM if_integrations WHERE id = ?").get(String(integrationId));
  if (!it || !owns(adminId, "if_integration", integrationId)) return { error: "not_found" };
  if (it.kind !== "webhook") throw new IfError("if_not_webhook");
  const n = clean(name, 80).trim();
  if (!n) throw new IfError("if_name_required");
  const count = db
    .prepare("SELECT COUNT(*) c FROM if_producers WHERE integration_id = ?")
    .get(it.id).c;
  if (count >= IF_LIMITS.max_producers_per_integration) throw new IfError("if_producer_limit");
  const id = uid();
  const secret = `whsec_${randomBytes(24).toString("hex")}`; // exibido UMA vez; cifrado no banco
  const ts = now();
  db.prepare(
    "INSERT INTO if_producers (id, owner_admin_id, integration_id, name, secret_encrypted, allowed_event_types_json, created_at) VALUES (?,?,?,?,?,?,?)",
  ).run(
    id,
    adminId,
    it.id,
    n,
    encrypt(secret),
    JSON.stringify(
      (Array.isArray(allowedEventTypes) ? allowedEventTypes : [])
        .map((t) => clean(t, 80))
        .slice(0, 50),
    ),
    ts,
  );
  audit("if.producer_created", { admin: adminId, ids: [id] });
  return {
    id,
    name: n,
    integration_id: it.id,
    secret,
    note: "Guarde o segredo agora: ele não será exibido novamente.",
  };
}

const producerView = (p) => ({
  id: p.id,
  integration_id: p.integration_id,
  name: p.name,
  allowed_event_types: parseJson(p.allowed_event_types_json, []),
  event_count: p.event_count,
  rejected_count: p.rejected_count,
  disabled_at: p.disabled_at,
  last_event_at: p.last_event_at,
  created_at: p.created_at,
});
export function listProducers(adminId, integrationId) {
  if (!owns(adminId, "if_integration", String(integrationId))) return []; // ownership no motor
  return db
    .prepare("SELECT * FROM if_producers WHERE integration_id = ? ORDER BY created_at")
    .all(String(integrationId))
    .map(producerView); // NUNCA devolve secret_encrypted
}

// ---------- webhook ingress (§7) ----------

const eventMinute = new Map(); // producerId -> [timestamps] (rate limit por produtor)

/** Verifica assinatura HMAC-SHA256 em tempo constante. Formato: `t=<unix-s>,v1=<hex>`. */
function verifySignature(rawBody, header, secret, nowMs) {
  if (typeof header !== "string" || !secret) return { ok: false, error: "if_signature_missing" };
  const m = /^t=(\d+),v1=([a-f0-9]{64})$/i.exec(header.trim());
  if (!m) return { ok: false, error: "if_signature_invalid" };
  const tsSec = Number(m[1]);
  // janela de validade (anti-replay): timestamp do header em SEGUNDOS vs relógio do backend
  const skewSec = IF_LIMITS.max_clock_skew_ms / 1000;
  if (!Number.isFinite(tsSec) || Math.abs(Math.floor(nowMs / 1000) - tsSec) > skewSec)
    return { ok: false, error: "if_timestamp_expired" };
  const expected = createHmac("sha256", secret).update(`${m[1]}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(m[2], "hex");
  const ok = a.length === b.length && timingSafeEqual(a, b); // tempo constante
  return ok ? { ok: true, ts: tsSec } : { ok: false, error: "if_signature_mismatch" };
}

/**
 * Ingest de webhook: autentica (HMAC sobre corpo BRUTO), valida esquema, protege contra
 * replay (idempotency_key UNIQUE por dono), deduplica e aceita DURAVELMENTE. O
 * processamento (Proactive Engine) é assíncrono. Resposta rápida: 202 aceito /
 * 4xx rejeitado com código estável. O payload NUNCA declara identidade: o produtor é a
 * credencial HMAC validada no backend.
 */
export function ingestWebhook(producerId, { headers = {}, rawBody, nowMs = Date.now() } = {}) {
  const p = db.prepare("SELECT * FROM if_producers WHERE id = ?").get(String(producerId));
  if (!p) return { status: 404, error: "not_found" };
  const it = db.prepare("SELECT * FROM if_integrations WHERE id = ?").get(p.integration_id);
  if (!it) return { status: 404, error: "not_found" };
  const reject = (code, status = 400) => {
    db.prepare("UPDATE if_producers SET rejected_count = rejected_count + 1 WHERE id = ?").run(
      p.id,
    );
    audit("if.webhook_rejected", { producer: p.id, status: code }); // sem payload/segredo
    return { status, error: code };
  };
  if (p.disabled_at || it.status === "disabled") return reject("if_integration_disabled", 409);
  // limite de tamanho (conta bytes do corpo BRUTO, não confia em Content-Length)
  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody ?? ""), "utf8");
  if (body.length === 0 || body.length > IF_LIMITS.max_payload_bytes)
    return reject("if_payload_too_large", 413);
  // rate limit por produtor
  const minuteAgo = nowMs - 60_000;
  const times = (eventMinute.get(p.id) || []).filter((t) => t > minuteAgo);
  if (times.length >= IF_LIMITS.max_events_per_minute) return reject("if_rate_limited", 429);
  // autenticação: assinatura HMAC-SHA256 sobre o corpo bruto com o segredo do produtor
  const secret = decrypt(p.secret_encrypted);
  const sig = verifySignature(body, headers["x-if-signature"], secret, nowMs);
  if (!sig.ok) return reject(sig.error, sig.error === "if_timestamp_expired" ? 401 : 401);
  times.push(nowMs);
  eventMinute.set(p.id, times);

  let parsed;
  try {
    parsed = JSON.parse(body.toString("utf8"));
  } catch {
    return reject("if_invalid_json");
  }
  // validação de esquema (versões conhecidas APENAS; payload é dado não confiável)
  const norm = normalizeExternalEvent(parsed, {
    producer: p,
    producerId: p.id,
    receivedAt: new Date(nowMs).toISOString(),
  });
  if (norm.error) return reject(norm.error);

  // replay/idempotência: UNIQUE(owner, idempotency_key) no banco
  try {
    const r = db
      .prepare(
        "INSERT INTO if_events (owner_admin_id, producer_id, event_id, event_type, schema_version, occurred_at, received_at, correlation_id, idempotency_key, payload_json, trust_level, provenance_json, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,'authenticated',?,'received',?)",
      )
      .run(
        p.owner_admin_id,
        p.id,
        clean(norm.event.event_id, 120),
        clean(norm.event.event_type, 80),
        clean(norm.event.schema_version, 12),
        clean(norm.event.occurred_at, 40) || null,
        norm.event.received_at,
        clean(norm.event.correlation_id, 120) || null,
        clean(norm.event.idempotency_key, 200),
        JSON.stringify(norm.event.payload ?? {}),
        JSON.stringify(norm.event.provenance ?? {}),
        now(),
      );
    const eventId = Number(r.lastInsertRowid);
    db.prepare(
      "UPDATE if_producers SET event_count = event_count + 1, last_event_at = ? WHERE id = ?",
    ).run(now(), p.id);
    audit("if.event_accepted", {
      producer: p.id,
      ids: [String(eventId)],
      type: clean(norm.event.event_type, 40),
    });
    return { status: 202, accepted: true, event_id: eventId, deduplicated: false };
  } catch (e) {
    if (/UNIQUE constraint failed/.test(String(e.message))) {
      // Replay: o evento ORIGINAL mantém seu status de processamento (o replay não é
      // armazenado nem reprocessado); contagem via auditoria.
      const existing = db
        .prepare("SELECT id FROM if_events WHERE owner_admin_id = ? AND idempotency_key = ?")
        .get(p.owner_admin_id, clean(norm.event.idempotency_key, 200));
      return { status: 200, accepted: false, deduplicated: true, event_id: existing?.id ?? null };
    }
    throw e;
  }
}

/** Encaminha eventos aceitos ao Proactive Engine (chamado pelo tick — assíncrono do ingress). */
export async function forwardIntegrationEvents(
  adminId,
  { limit = IF_LIMITS.max_batch_events } = {},
) {
  // adminId nulo (boot/tick global): processa por todos os donos com eventos pendentes
  if (!adminId) {
    const owners = db
      .prepare(
        "SELECT DISTINCT owner_admin_id o FROM if_events WHERE status = 'received' LIMIT 100",
      )
      .all();
    let total = 0;
    for (const o of owners)
      total += (await forwardIntegrationEvents(o.o, { limit })).forwarded || 0;
    return { forwarded: total };
  }
  const rows = db
    .prepare(
      "SELECT id, event_type, payload_json, producer_id, correlation_id, event_id FROM if_events WHERE owner_admin_id = ? AND status = 'received' ORDER BY id LIMIT ?",
    )
    .all(
      adminId,
      Math.min(
        Math.max(Number(limit) || IF_LIMITS.max_batch_events, 1),
        IF_LIMITS.max_batch_events,
      ),
    );
  let forwarded = 0;
  for (const e of rows) {
    const payload = parseJson(e.payload_json, {});
    const res = await recordExternalEvent(adminId, {
      producerId: e.producer_id,
      eventType: e.event_type,
      payload,
      externalEventRowId: e.id,
      correlationId: e.correlation_id,
    });
    if (res?.opportunityId || res?.started || res?.error) forwarded++;
    // status do if_event reflete o resultado do encaminhamento
    db.prepare("UPDATE if_events SET status = ? WHERE id = ?").run(
      res?.skipped || res?.error ? "error" : "forwarded",
      e.id,
    );
    if (res?.error || res?.skipped)
      db.prepare("UPDATE if_events SET error_code = ? WHERE id = ?").run(
        clean(res.error || res.skipped, 60),
        e.id,
      );
  }
  return { forwarded };
}

// ---------- normalização canônica (§8) ----------

const SCHEMA_VERSIONS = new Set(["1", "1.0", "1.1"]);
const EVENT_TYPE_RE = /^[a-z][a-z0-9._-]{2,79}$/;

/**
 * Normaliza o corpo externo para o contrato canônico. Campos de identidade/confiança
 * SEMPRE vêm do backend (produtor autenticado); o payload nunca se autodeclara.
 * Rejeita versões de schema desconhecidas e tipos fora do padrão.
 */
/** Event Inspector: eventos externos do dono (§14) — payload sob demanda, sem segredos. */
export function listEvents(adminId, { limit = 100 } = {}) {
  if (!adminId) return [];
  return db
    .prepare(
      "SELECT e.id, e.producer_id, p.name AS producer_name, e.event_id, e.event_type, e.schema_version, e.occurred_at, e.received_at, e.correlation_id, e.idempotency_key, e.trust_level, e.status, e.error_code, e.payload_json, e.created_at FROM if_events e JOIN if_producers p ON p.id = e.producer_id WHERE e.owner_admin_id = ? ORDER BY e.id DESC LIMIT ?",
    )
    .all(adminId, Math.min(Math.max(Number(limit) || 100, 1), 500))
    .map((e) => ({ ...e, payload: parseJson(e.payload_json, {}) }));
}

export function normalizeExternalEvent(body, { producer, receivedAt }) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    return { error: "if_invalid_schema" };
  const allowed = parseJson(producer.allowed_event_types_json, []);
  const eventType = clean(body.event_type ?? body.type, 80);
  if (!EVENT_TYPE_RE.test(eventType)) return { error: "if_invalid_event_type" };
  if (allowed.length && !allowed.includes(eventType)) return { error: "if_event_type_not_allowed" };
  const schemaVersion = clean(body.schema_version ?? "1", 12);
  if (!SCHEMA_VERSIONS.has(schemaVersion)) return { error: "if_unknown_schema_version" }; // rejeita versão desconhecida
  const eventId = clean(body.event_id ?? body.id, 120);
  if (!eventId) return { error: "if_missing_event_id" };
  const occurred = clean(body.occurred_at, 40);
  if (occurred && !Number.isFinite(Date.parse(occurred)))
    return { error: "if_invalid_occurred_at" };
  // payload do produtor: tamanho limitado, SEM campos de confiança (trust é do backend)
  const raw = body.payload && typeof body.payload === "object" ? body.payload : {};
  const payload = {};
  for (const [k, v] of Object.entries(raw).slice(0, 30)) {
    if (["trust_level", "provenance", "producer_id", "authenticated"].includes(clean(k, 40)))
      continue; // tentativa de autopromoção descartada
    if (v === null || typeof v === "string" || typeof v === "number" || typeof v === "boolean")
      payload[clean(k, 60)] = v;
  }
  return {
    event: {
      event_id: eventId,
      producer_id: producer.id, // identidade do BACKEND (credencial HMAC), nunca do corpo
      event_type: eventType,
      schema_version: schemaVersion,
      occurred_at: occurred || receivedAt,
      received_at: receivedAt,
      correlation_id: clean(body.correlation_id, 120) || null,
      idempotency_key: clean(body.idempotency_key ?? `${producer.id}:${eventId}`, 200),
      payload,
      trust_level: "authenticated",
      provenance: {
        integration: producer.integration_id,
        producer: producer.name,
        received_via: "webhook_hmac_sha256",
      },
    },
  };
}

/** Encaminha UM evento normalizado ao Proactive Engine (fonte 'integrations'). */
async function recordExternalEvent(
  adminId,
  { producerId, eventType, payload, externalEventRowId, correlationId },
) {
  const ev = prEngine.recordEvent(adminId, {
    source: "integrations",
    kind: clean(eventType, 60),
    payload,
    dedupeKey: `if-event:${externalEventRowId}`,
  });
  if (ev.duplicate) return { skipped: "pr_duplicate" };
  // Fase 9 (correção da auditoria): avalia TODAS as regras que escutam o evento —
  // cooldown/pausa de UMA regra nunca bloqueia as irmãs (antes: return na 1ª match).
  const rules = db
    .prepare(
      "SELECT id, trigger_json FROM pr_rules WHERE owner_admin_id = ? AND state = 'active' AND trigger_kind = 'event'",
    )
    .all(adminId);
  const results = [];
  for (const r of rules) {
    const trigger = parseJson(r.trigger_json, {});
    if (trigger.source !== "integrations" || trigger.eventKind !== clean(eventType, 60)) continue;
    try {
      results.push(await prEngine.handleRuleTriggered(adminId, r.id, { event: ev.event }));
    } catch (e) {
      results.push({ error: clean(e?.code || e?.message, 60) });
    }
  }
  if (!results.length) return { recorded: true }; // evento registrado; nenhuma regra casou
  // resultado agregado: a primeira decisão que criou/executou representa o encaminhamento
  return (
    results.find((x) => x.opportunityId || x.error) || results.find((x) => !x.skipped) || results[0]
  );
}
import * as prEngine from "./proactive.js"; // sem ciclo: proactive.js não importa este módulo

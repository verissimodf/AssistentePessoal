// Calendar Provider abstraction — evolução Fase 8 (docs/evolution/phase-8).
// Provider INDEPENDENTE de fornecedor com sincronização incremental (cursor), dedupe
// (UNIQUE account+external_id), detecção de conflitos e reconciliação. Providers
// registrados: 'fixture' (TESTE, claramente identificado) e 'google' (implementado
// contra a API oficial via oauth_connections EXISTENTE — só é FUNCIONAL com conexão
// OAuth real; caso contrário: indisponibilidade EXPLÍCITA, nunca simulação).
import { parseJson, clean } from "./util.js";
import { db, now, uid, audit } from "./db.js";
import { assignNew, owns } from "./ownership.js";
import { getOAuthAccessToken, OAuthError } from "./oauth.js";
import { recordEvent } from "./proactive.js"; // sem ciclo: proactive.js não importa calendar.js

export const IF_SYNC_LIMITS = { max_events_per_sync: 500 };

// ---------- registro de providers ----------

const providers = new Map();

export function registerCalendarProvider(name, impl) {
  if (!name || typeof impl !== "object") throw new Error("if_provider_invalid");
  providers.set(name, impl);
}
export function getCalendarProvider(name) {
  return providers.get(String(name || "")) || null;
}
export const listCalendarProviders = () => [...providers.keys()];

// ---------- provider FIXTURE (identificado como teste — nunca simulado como real) ----------

export function createFixtureCalendarProvider() {
  const store = new Map(); // accountKey -> { cursor, events: Map(external_id -> ev) }
  const st = (k) => {
    if (!store.has(k)) store.set(k, { cursor: 0, changed: [], events: new Map() });
    return store.get(k);
  };
  return {
    id: "fixture",
    testOnly: true, // marcado: NUNCA é declarado como integração real
    healthCheck: () => ({ ok: true, provider: "fixture", note: "provider de TESTE (sem rede)" }),
    async listEvents(account, { sinceCursor = 0 } = {}) {
      const s = st(account.provider_account); // chave = conta do provider (não id do banco)
      const changed = s.changed.filter((c) => c.seq > sinceCursor);
      return { events: changed.map((c) => c.ev), cursor: s.cursor, testOnly: true };
    },
    // API de teste: injeta/muda/cancela eventos no provider (fixtures explícitas)
    __fixture: {
      upsert(accountKey, ev) {
        const s = st(accountKey);
        s.cursor += 1;
        const full = { status: "confirmed", timezone: "UTC", recurrence: [], ...ev };
        s.events.set(full.external_id, full);
        s.changed.push({ seq: s.cursor, ev: full });
        return full;
      },
      cancel(accountKey, externalId) {
        const s = st(accountKey);
        const ev = s.events.get(externalId);
        if (!ev) return false;
        s.cursor += 1;
        ev.status = "cancelled";
        s.changed.push({ seq: s.cursor, ev });
        return true;
      },
      reset(accountKey) {
        store.delete(accountKey);
      },
    },
  };
}

// ---------- provider GOOGLE (API oficial; FUNCIONAL só com conexão OAuth real) ----------

function googleCalendarProvider() {
  const API = "https://www.googleapis.com/calendar/v3";
  const headers = (token) => ({
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  });
  return {
    id: "google",
    testOnly: false, // implementado contra API oficial; FUNCIONAL só com OAuth real conectado
    async healthCheck(account) {
      try {
        const token = await getOAuthAccessToken(account.owner_admin_id, "google");
        if (!token) return { ok: false, error: "cal_oauth_not_connected" }; // indisponibilidade EXPLÍCITA
        const r = await fetch(`${API}/calendars/primary`, {
          headers: headers(token),
          signal: AbortSignal.timeout(10_000),
        });
        return { ok: r.ok, status: r.status };
      } catch (e) {
        return { ok: false, error: e instanceof OAuthError ? e.code : "cal_provider_unavailable" };
      }
    },
    async listEvents(account, { sinceCursor = 0 } = {}) {
      const token = await getOAuthAccessToken(account.owner_admin_id, "google");
      if (!token) throw new OAuthError(403, "cal_oauth_not_connected"); // nunca simular
      const params = new URLSearchParams({
        maxResults: String(IF_SYNC_LIMITS.max_events_per_sync),
        showDeleted: "true",
        singleEvents: "false",
      });
      const r = await fetch(`${API}/calendars/primary/events?${params}`, {
        headers: headers(token),
        signal: AbortSignal.timeout(20_000),
      });
      if (!r.ok) throw new OAuthError(502, "cal_provider_error");
      const data = await r.json();
      const events = (data.items || []).map((it) => ({
        external_id: clean(it.id, 200),
        title: clean(it.summary || "(sem título)", 200),
        starts_at_utc: it.created ? new Date(it.updated).toISOString() : new Date().toISOString(),
        ends_at_utc: it.end?.dateTime || it.end?.date || null,
        timezone: it.start?.timeZone || "UTC",
        recurrence: Array.isArray(it.recurrence)
          ? it.recurrence.map((x) => clean(x, 200)).slice(0, 10)
          : [],
        status: it.status === "cancelled" || it.status === "deleted" ? "cancelled" : "confirmed",
      }));
      return { events, cursor: Date.now(), syncTokenHint: clean(data.nextSyncToken, 200) || null };
    },
  };
}

registerCalendarProvider("fixture", createFixtureCalendarProvider());
registerCalendarProvider("google", googleCalendarProvider());

// ---------- contas e sincronização ----------

export function connectCalendarAccount(
  adminId,
  integrationId,
  { provider, providerAccount, config = {} } = {},
) {
  if (!adminId) throw new Error("if_owner_required");
  const it = db.prepare("SELECT * FROM if_integrations WHERE id = ?").get(String(integrationId));
  if (!it || !owns(adminId, "if_integration", integrationId)) return { error: "not_found" };
  if (it.kind !== "calendar") throw new Error("if_not_calendar");
  if (!getCalendarProvider(provider)) throw new Error("if_unknown_adapter");
  const pa = clean(providerAccount, 120).trim();
  if (!pa) throw new Error("if_account_required");
  const id = uid();
  const ts = now();
  db.prepare(
    "INSERT INTO cal_accounts (id, owner_admin_id, integration_id, provider, provider_account, config_json, status, created_at, updated_at) VALUES (?,?,?,?,?,?,'configured',?,?)",
  ).run(id, adminId, it.id, provider, pa, JSON.stringify(config ?? {}), ts, ts);
  assignNew("cal_account", id, adminId);
  audit("if.calendar_connected", { admin: adminId, ids: [id], provider });
  return getCalendarAccount(adminId, id);
}

export function getCalendarAccount(adminId, id) {
  const r = db.prepare("SELECT * FROM cal_accounts WHERE id = ?").get(String(id));
  if (!r || !owns(adminId, "cal_account", id)) return null;
  return {
    ...r,
    config: parseJson(r.config_json, {}),
    provider_test_only: getCalendarProvider(r.provider)?.testOnly === true,
  };
}

export function listCalendarAccounts(adminId) {
  if (!adminId) return [];
  return db
    .prepare("SELECT * FROM cal_accounts WHERE owner_admin_id = ? ORDER BY created_at DESC")
    .all(adminId)
    .map((r) => ({
      ...r,
      config: parseJson(r.config_json, {}),
      provider_test_only: getCalendarProvider(r.provider)?.testOnly === true,
    }));
}

/**
 * Sincronização INCREMENTAL de uma conta: cursor persistido, dedupe por external_id,
 * detecção de conflitos (sobreposição entre eventos confirmados), exclusões (status
 * cancelled do provider vence). Eventos recebidos NÃO estão ordenados — cada um é
 * processado por external_id com checksum de atualização.
 */
export async function syncCalendarAccount(adminId, accountId, { force = false } = {}) {
  const acc = getCalendarAccount(adminId, accountId);
  if (!acc) return { error: "not_found" };
  if (acc.status === "disabled") return { error: "if_integration_disabled" };
  const provider = getCalendarProvider(acc.provider);
  if (!provider) return { error: "if_unknown_adapter" };
  const cursor = acc.sync_cursor ? Number(acc.sync_cursor) : 0;
  let result;
  try {
    result = await provider.listEvents(acc, { sinceCursor: cursor });
  } catch (e) {
    const code = e?.code || "cal_provider_unavailable";
    db.prepare(
      "UPDATE cal_accounts SET last_error = ?, status = 'degraded', updated_at = ? WHERE id = ?",
    ).run(clean(code, 60), now(), accountId);
    return { error: code }; // indisponibilidade EXPLÍCITA (nunca simular)
  }
  let upserted = 0;
  let cancelled = 0;
  const seen = new Set();
  for (const ev of (result.events || []).slice(0, IF_SYNC_LIMITS.max_events_per_sync)) {
    if (!ev?.external_id) continue;
    seen.add(ev.external_id);
    if (ev.status === "cancelled") cancelled++;
    const existing = db
      .prepare("SELECT id, checksum FROM cal_events WHERE account_id = ? AND external_id = ?")
      .get(accountId, clean(ev.external_id, 200));
    const checksum = Buffer.from(JSON.stringify(ev)).toString("base64").slice(0, 120);
    if (existing && existing.checksum === checksum && !force) continue; // sem mudança
    if (existing) {
      // política de conflito (ADR IF-005): o PROVIDER vence (fonte da verdade da agenda);
      // mudanças locais não existem nesta fase (somente leitura) — nada do usuário é sobrescrito
      db.prepare(
        "UPDATE cal_events SET title=?, starts_at_utc=?, ends_at_utc=?, timezone=?, recurrence_json=?, status=?, checksum=?, updated_at=? WHERE id=?",
      ).run(
        clean(ev.title, 200),
        clean(ev.starts_at_utc, 40),
        ev.ends_at_utc ? clean(ev.ends_at_utc, 40) : null,
        clean(ev.timezone || "UTC", 60),
        JSON.stringify(Array.isArray(ev.recurrence) ? ev.recurrence : []),
        ev.status === "cancelled" ? "cancelled" : "confirmed",
        checksum,
        now(),
        existing.id,
      );
      upserted++;
    } else {
      db.prepare(
        "INSERT INTO cal_events (id, owner_admin_id, account_id, external_id, title, starts_at_utc, ends_at_utc, timezone, recurrence_json, status, checksum, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        uid(),
        adminId,
        accountId,
        clean(ev.external_id, 200),
        clean(ev.title, 200),
        clean(ev.starts_at_utc, 40),
        ev.ends_at_utc ? clean(ev.ends_at_utc, 40) : null,
        clean(ev.timezone || "UTC", 60),
        JSON.stringify(Array.isArray(ev.recurrence) ? ev.recurrence : []),
        ev.status === "cancelled" ? "cancelled" : "confirmed",
        checksum,
        now(),
      );
      upserted++;
    }
  }
  detectConflicts(adminId, accountId);
  db.prepare(
    "UPDATE cal_accounts SET sync_cursor = ?, last_sync_at = ?, last_error = NULL, status = 'active', updated_at = ? WHERE id = ?",
  ).run(String(result.cursor ?? cursor), now(), now(), accountId);
  audit("if.calendar_synced", { admin: adminId, ids: [accountId], upserted, cancelled });
  // alimenta o Proactive Engine (fonte 'calendar') — regras decidem relevância
  const evRes = recordEvent(adminId, {
    source: "calendar",
    kind: "calendar_synced",
    payload: {
      account_id: accountId,
      upserted,
      cancelled,
      provider: acc.provider,
      provider_test_only: acc.provider_test_only,
    },
    dedupeKey: `cal-sync:${accountId}:${result.cursor ?? cursor}`,
  });
  return {
    upserted,
    cancelled,
    cursor: result.cursor ?? cursor,
    testOnly: provider.testOnly === true,
    proactive: evRes.duplicate ? "duplicate" : "recorded",
  };
}

/** Conflitos: sobreposição de horários entre eventos confirmados da mesma conta. */
export function detectConflicts(adminId, accountId) {
  const rows = db
    .prepare(
      "SELECT id, starts_at_utc, ends_at_utc FROM cal_events WHERE account_id = ? AND status = 'confirmed' AND ends_at_utc IS NOT NULL ORDER BY starts_at_utc",
    )
    .all(accountId);
  const detected = [];
  for (let i = 0; i < rows.length; i++)
    for (let j = i + 1; j < rows.length; j++) {
      const a = rows[i];
      const b = rows[j];
      if (b.starts_at_utc < a.ends_at_utc && a.starts_at_utc < b.ends_at_utc) {
        const [ea, eb] = [a.id, b.id].sort();
        const exists = db
          .prepare(
            "SELECT id FROM cal_conflicts WHERE account_id = ? AND event_a = ? AND event_b = ? AND resolved_at IS NULL",
          )
          .get(accountId, ea, eb);
        if (!exists) {
          db.prepare(
            "INSERT INTO cal_conflicts (id, owner_admin_id, account_id, event_a, event_b, kind, detected_at) VALUES (?,?,?,?,?,'overlap',?)",
          ).run(uid(), adminId, accountId, ea, eb, now());
          detected.push(`${ea}:${eb}`);
        }
      }
    }
  return detected;
}

export function listConflicts(adminId, accountId) {
  const acc = getCalendarAccount(adminId, accountId);
  if (!acc) return null;
  return db
    .prepare(
      "SELECT * FROM cal_conflicts WHERE account_id = ? AND resolved_at IS NULL ORDER BY detected_at DESC",
    )
    .all(accountId)
    .map((c) => ({
      ...c,
      eventA: db
        .prepare("SELECT external_id, title, starts_at_utc FROM cal_events WHERE id = ?")
        .get(c.event_a),
      eventB: db
        .prepare("SELECT external_id, title, starts_at_utc FROM cal_events WHERE id = ?")
        .get(c.event_b),
    }));
}

export function listCalendarEvents(adminId, accountId, { limit = 100 } = {}) {
  const acc = getCalendarAccount(adminId, accountId);
  if (!acc) return null;
  return db
    .prepare(
      "SELECT id, external_id, title, starts_at_utc, ends_at_utc, timezone, recurrence_json, status, updated_at FROM cal_events WHERE account_id = ? ORDER BY starts_at_utc LIMIT ?",
    )
    .all(accountId, Math.min(Math.max(Number(limit) || 100, 1), 500))
    .map((e) => ({ ...e, recurrence: parseJson(e.recurrence_json, []) }));
}

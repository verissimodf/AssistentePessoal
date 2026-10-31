// Proactive Intelligence Engine — evolução Fase 7 (docs/evolution/phase-7).
// Observação → detecção de condição → oportunidade → recomendação → aprovação → execução
// → verificação → registro. PRINCÍPIO CENTRAL: proatividade NÃO é autonomia irrestrita —
// nenhuma execução nasce aqui: workflows iniciam SEMPRE por startWorkflowRun (Policy
// Engine + D9 nativos) e operações protegidas continuam exigindo aprovação humana com
// fingerprint. Níveis de autonomia governam o que o motor pode fazer SOZINHO (0=observar,
// 1=recomendar, 2=iniciar workflows seguros, 3=condicionada ao D9) — nunca sobrepor o
// Policy Engine. Eventos internos são DADOS: dedupe por chave idempotente, fail-closed.
import { parseJson, clean } from "./util.js";
import { db, now, uid, audit } from "./db.js";
import { assignNew, owns, tx } from "./ownership.js";
import { startWorkflowRun, getWfRun, setWfEventSink } from "./workflow.js";
import { getSettings } from "./settings.js";

export const PR_LIMITS = {
  max_rules_per_owner: 50,
  max_pending_opportunities: 50,
  max_events_per_minute: 60,
  max_executions_per_hour: 10,
  default_cooldown_ms: 60_000,
  max_conditions_depth: 4,
  max_conditions_nodes: 20,
  max_justification_chars: 2000,
  max_pending_per_rule: 5,
  max_notifications: 200,
  max_occurrence_delay_ms: 60 * 60 * 1000, // Fase 8: ocorrência atrasada além disso é descartada com motivo
};

export const SOURCES = new Set([
  "workflow",
  "research",
  "learning",
  "kh",
  "workforce",
  "mm",
  "computer",
  "manual",
  "system",
  "integrations", // Fase 8: Integration Fabric (eventos externos autenticados e normalizados)
  "calendar", // Fase 8: eventos de calendário (provider abstrato)
]);

const RULE_STATES = new Set(["draft", "active", "paused", "disabled", "expired", "failed"]);
const OPP_STATUSES = new Set([
  "detected",
  "evaluating",
  "recommended",
  "dismissed",
  "snoozed",
  "accepted",
  "executing",
  "completed",
  "failed",
  "expired",
]);

export class PrError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = "PrError";
    this.code = code;
  }
}

// ---------- controles (nível de autonomia etc.) ----------

export const AUTONOMY_LEVELS = [0, 1, 2, 3];

/** Controles por admin (admin_settings.proactive) — validados no backend; defaults seguros. */
export function getControls(adminId, { settings = null } = {}) {
  const s = settings ?? (adminId ? getSettings(adminId) : {});
  const v = (s || {}).proactive || {};
  const level = AUTONOMY_LEVELS.includes(v.level) ? v.level : 1;
  return {
    level,
    paused: v.paused === true,
    timezone: tzValidate(v.timezone) ? v.timezone : "UTC", // Fase 8: tz do usuário
    maxExecutionsPerHour: clampInt(
      v.maxExecutionsPerHour,
      1,
      100,
      PR_LIMITS.max_executions_per_hour,
    ),
    cooldownMs: clampInt(v.cooldownMs, 0, 24 * 60 * 60 * 1000, PR_LIMITS.default_cooldown_ms),
    maxPendingOpportunities: clampInt(
      v.maxPendingOpportunities,
      1,
      200,
      PR_LIMITS.max_pending_opportunities,
    ),
  };
}
const clampInt = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : dflt;
};

export function validateControls(body = {}) {
  const out = {};
  if (body.level !== undefined) {
    if (!AUTONOMY_LEVELS.includes(body.level)) throw new PrError("pr_invalid_level");
    out.level = body.level;
  }
  if (body.paused !== undefined) {
    if (typeof body.paused !== "boolean") throw new PrError("pr_invalid_controls");
    out.paused = body.paused;
  }
  if (body.timezone !== undefined) {
    if (typeof body.timezone !== "string" || !tzValidate(body.timezone))
      throw new PrError("pr_invalid_timezone"); // Fase 8: tz IANA do usuário
    out.timezone = body.timezone;
  }
  if (body.maxExecutionsPerHour !== undefined)
    out.maxExecutionsPerHour = clampInt(
      body.maxExecutionsPerHour,
      1,
      100,
      PR_LIMITS.max_executions_per_hour,
    );
  if (body.cooldownMs !== undefined)
    out.cooldownMs = clampInt(
      body.cooldownMs,
      0,
      24 * 60 * 60 * 1000,
      PR_LIMITS.default_cooldown_ms,
    );
  if (body.maxPendingOpportunities !== undefined)
    out.maxPendingOpportunities = clampInt(
      body.maxPendingOpportunities,
      1,
      200,
      PR_LIMITS.max_pending_opportunities,
    );
  return out;
}

// ---------- motor de condições (determinístico, fail-closed, sem eval) ----------

const COMPARATORS = new Set([
  "eq",
  "ne",
  "gt",
  "gte",
  "lt",
  "lte",
  "contains",
  "exists",
  "missing",
  "in",
]);

/** Validação ESTRUTURAL em tempo de salvar: operadores/campos inválidos são rejeitados. */
function assertConditionsValid(node, d = 0) {
  if (d > PR_LIMITS.max_conditions_depth) throw new PrError("pr_invalid_conditions");
  if (!node || typeof node !== "object" || Array.isArray(node))
    throw new PrError("pr_invalid_conditions");
  if (node.all) {
    if (!Array.isArray(node.all)) throw new PrError("pr_invalid_conditions");
    return node.all.forEach((c) => assertConditionsValid(c, d + 1));
  }
  if (node.any) {
    if (!Array.isArray(node.any)) throw new PrError("pr_invalid_conditions");
    return node.any.forEach((c) => assertConditionsValid(c, d + 1));
  }
  if (node.not !== undefined && node.not !== null) return assertConditionsValid(node.not, d + 1);
  if (!COMPARATORS.has(node.op)) throw new PrError("pr_invalid_conditions");
  if (!clean(node.fact, 100) && !["exists", "missing"].includes(node.op))
    throw new PrError("pr_invalid_conditions");
  if (node.op === "in" && !Array.isArray(node.value)) throw new PrError("pr_invalid_conditions");
}

function compare(op, actual, expected) {
  switch (op) {
    case "eq":
      return actual === expected;
    case "ne":
      return actual !== expected;
    case "gt":
    case "gte":
    case "lt":
    case "lte": {
      if (typeof actual !== "number" || typeof expected !== "number") return false; // tipos validados
      if (op === "gt") return actual > expected;
      if (op === "gte") return actual >= expected;
      if (op === "lt") return actual < expected;
      return actual <= expected;
    }
    case "contains":
      return typeof actual === "string" && actual.includes(String(expected));
    case "exists":
      return actual !== undefined && actual !== null;
    case "missing":
      return actual === undefined || actual === null;
    case "in":
      return Array.isArray(expected) && expected.includes(actual);
    default:
      return false; // operador desconhecido: fail-closed
  }
}

/**
 * Avalia a árvore de condições contra `facts` (payload do evento). Determinística, sem
 * eval, com limites de profundidade/tamanho e fail-closed: dado ausente/tipo errado/
 * operador inválido → falso COM razão registrada. Devolve { ok, reasons, evaluated }.
 */
export function evaluateConditions(conditions, facts, { depth = 0 } = {}) {
  // Sem condições (vazio/nulo) = sempre verdadeiro (regra dispara em qualquer evento).
  if (!conditions || (Array.isArray(conditions) && conditions.length === 0))
    return { ok: true, reasons: [], evaluated: 0 };
  const reasons = [];
  const checked = { count: 0, violated: false };
  const walk = (node, d) => {
    if (checked.count >= PR_LIMITS.max_conditions_nodes) {
      checked.violated = true; // VIOLAÇÃO é terminal: nunca invertível por NOT na árvore
      reasons.push("too_many_nodes");
      return false;
    }
    checked.count += 1;
    if (!node || typeof node !== "object" || Array.isArray(node)) {
      reasons.push("invalid_node");
      return false;
    }
    if (d > PR_LIMITS.max_conditions_depth) {
      checked.violated = true;
      reasons.push("too_deep");
      return false;
    }
    if (node.all) {
      if (!Array.isArray(node.all)) {
        reasons.push("invalid_all");
        return false;
      }
      return node.all.every((c) => walk(c, d + 1));
    }
    if (node.any) {
      if (!Array.isArray(node.any)) {
        reasons.push("invalid_any");
        return false;
      }
      return node.any.some((c) => walk(c, d + 1));
    }
    if (node.not !== undefined && node.not !== null) {
      const mark = reasons.length;
      const inner = walk(node.not, d + 1);
      if (inner)
        reasons.splice(mark); // negação tornou verdadeiro falso: razões internas irrelevantes
      else reasons.push("not_negation_failed");
      return !inner;
    }
    const op = node.op;
    if (!COMPARATORS.has(op)) {
      reasons.push(`unknown_op:${clean(op, 24)}`);
      return false;
    }
    const factPath = clean(node.fact, 100);
    if (!factPath && !["exists", "missing"].includes(op)) {
      reasons.push("missing_fact_path");
      return false;
    }
    const actual = factPath
      ? factPath
          .split(".")
          .reduce((acc, k) => (acc && typeof acc === "object" ? acc[k] : undefined), facts ?? {})
      : undefined;
    const ok = compare(op, actual, node.value);
    if (!ok) reasons.push(`${factPath} ${op} ${JSON.stringify(node.value ?? null)}`.slice(0, 120));
    return ok;
  };
  const ok = walk(conditions, depth) && !checked.violated; // fail-closed: violação ⇒ falso
  return { ok, reasons, evaluated: checked.count };
}

// ---------- regras ----------

const ruleView = (r) => ({
  ...r,
  trigger: parseJson(r.trigger_json, {}),
  conditions: parseJson(r.conditions_json, []),
  params: parseJson(r.params_json, {}),
});

function snapshotOf(rule) {
  const {
    id,
    version,
    created_at,
    updated_at,
    execution_count,
    last_run_at,
    next_run_at,
    last_error,
    ...rest
  } = rule;
  return rest;
}

const TRIGGER_KINDS = new Set(["event", "temporal", "contextual"]);

function validateTrigger(kind, trigger = {}) {
  if (!trigger || typeof trigger !== "object") throw new PrError("pr_invalid_trigger");
  if (kind === "event") {
    if (!SOURCES.has(trigger.source)) throw new PrError("pr_invalid_trigger_source");
    if (typeof trigger.eventKind !== "string" || !trigger.eventKind.trim())
      throw new PrError("pr_invalid_trigger_kind");
    return { source: trigger.source, eventKind: clean(trigger.eventKind, 60) };
  }
  if (kind === "temporal") {
    const type = trigger.type;
    if (!["daily", "weekly", "monthly", "interval", "date"].includes(type))
      throw new PrError("pr_invalid_trigger_type");
    const out = { type };
    if (type === "daily") {
      if (!/^\d{2}:\d{2}$/.test(String(trigger.time || "")))
        throw new PrError("pr_invalid_trigger_time");
      out.time = trigger.time;
    } else if (type === "weekly") {
      if (!/^\d{2}:\d{2}$/.test(String(trigger.time || "")))
        throw new PrError("pr_invalid_trigger_time");
      if (trigger.weekday === undefined && !Array.isArray(trigger.weekdays))
        throw new PrError("pr_invalid_trigger_weekday");
      out.time = trigger.time;
      // dia único OU lista de dias específicos (Fase 8)
      if (trigger.weekday !== undefined) {
        if (!Number.isInteger(trigger.weekday) || trigger.weekday < 0 || trigger.weekday > 6)
          throw new PrError("pr_invalid_trigger_weekday");
        out.weekday = trigger.weekday;
      }
      if (Array.isArray(trigger.weekdays)) {
        if (
          !trigger.weekdays.every((x) => Number.isInteger(x) && x >= 0 && x <= 6) ||
          !trigger.weekdays.length
        )
          throw new PrError("pr_invalid_trigger_weekday");
        out.weekdays = [...new Set(trigger.weekdays)];
      }
    } else if (type === "monthly") {
      if (!Number.isInteger(trigger.day) || trigger.day < 1 || trigger.day > 31)
        throw new PrError("pr_invalid_trigger_day");
      if (!/^\d{2}:\d{2}$/.test(String(trigger.time || "")))
        throw new PrError("pr_invalid_trigger_time");
      out.day = trigger.day;
      out.time = trigger.time;
    } else if (type === "interval") {
      const ms = Number(trigger.intervalMs);
      if (!Number.isInteger(ms) || ms < 60_000) throw new PrError("pr_invalid_trigger_interval");
      out.intervalMs = ms;
    } else if (type === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(trigger.date || "")))
        throw new PrError("pr_invalid_trigger_date");
      out.date = trigger.date;
      if (trigger.time && /^\d{2}:\d{2}$/.test(trigger.time)) out.time = trigger.time;
    }
    // janela de horário opcional (§10.1): o disparo só ocorre dentro da janela local
    if (trigger.window !== undefined) {
      const win = trigger.window || {};
      if (
        !/^\d{2}:\d{2}$/.test(String(win.from || "")) ||
        !/^\d{2}:\d{2}$/.test(String(win.to || ""))
      )
        throw new PrError("pr_invalid_trigger_window");
      out.window = { from: win.from, to: win.to };
    }
    return out;
  }
  // contextual: gatilho declarativo (fonte/kind livre entre as fontes registradas)
  if (trigger.source && !SOURCES.has(trigger.source))
    throw new PrError("pr_invalid_trigger_source");
  return {
    source: trigger.source || null,
    eventKind: trigger.eventKind ? clean(trigger.eventKind, 60) : null,
  };
}

/** Valida e normaliza o corpo de criação/edição de regra (TUDO validado no backend). */
function validateRuleBody(body, { partial = false } = {}) {
  const out = {};
  if (!partial || body.name !== undefined) {
    const name = clean(body.name, 80).trim();
    if (!name) throw new PrError("pr_name_required");
    out.name = name;
  }
  if (body.description !== undefined) out.description = clean(body.description, 1000);
  if (body.triggerKind !== undefined) {
    if (!TRIGGER_KINDS.has(body.triggerKind)) throw new PrError("pr_invalid_trigger_kind");
    out.trigger_kind = body.triggerKind;
  }
  if (body.trigger !== undefined) {
    const kind = out.trigger_kind || (partial ? null : "event");
    if (kind) out.trigger_json = JSON.stringify(validateTrigger(kind, body.trigger));
  }
  if (body.conditions !== undefined) {
    if (!Array.isArray(body.conditions) && typeof body.conditions !== "object")
      throw new PrError("pr_invalid_conditions");
    assertConditionsValid(body.conditions ?? []); // estrutura inválida é REJEITADA no save
    out.conditions_json = JSON.stringify(body.conditions ?? []);
  }
  if (body.workflowId !== undefined)
    out.workflow_id = body.workflowId ? clean(body.workflowId, 64) : null;
  if (body.params !== undefined) out.params_json = JSON.stringify(body.params ?? {});
  if (body.execution !== undefined) {
    if (!["manual", "auto"].includes(body.execution)) throw new PrError("pr_invalid_execution");
    out.execution = body.execution;
  }
  if (body.validFrom !== undefined)
    out.valid_from = body.validFrom ? clean(body.validFrom, 30) : null;
  if (body.validUntil !== undefined)
    out.valid_until = body.validUntil ? clean(body.validUntil, 30) : null;
  if (body.maxExecutions !== undefined) {
    const n = Number(body.maxExecutions);
    if (body.maxExecutions !== null && (!Number.isInteger(n) || n < 1))
      throw new PrError("pr_invalid_max_executions");
    out.max_executions = body.maxExecutions === null ? null : n;
  }
  if (body.cooldownMs !== undefined)
    out.cooldown_ms = clampInt(
      body.cooldownMs,
      0,
      24 * 60 * 60 * 1000,
      PR_LIMITS.default_cooldown_ms,
    );
  if (body.timezone !== undefined) {
    // Fase 8: timezone IANA por regra; inválida é rejeitada (fail-closed, nunca UTC silencioso)
    if (typeof body.timezone !== "string" || !tzValidate(body.timezone))
      throw new PrError("pr_invalid_timezone");
    out.timezone = body.timezone;
  }
  return out;
}

export function createRule(adminId, body = {}) {
  if (!adminId) throw new PrError("pr_owner_required");
  const data = validateRuleBody(body);
  if (!data.trigger_kind) throw new PrError("pr_invalid_trigger_kind");
  const count = db
    .prepare("SELECT COUNT(*) n FROM pr_rules WHERE owner_admin_id = ?")
    .get(adminId).n;
  if (count >= PR_LIMITS.max_rules_per_owner) throw new PrError("pr_rule_limit");
  const id = uid();
  const ts = now();
  tx(() => {
    db.prepare(
      `INSERT INTO pr_rules (id, owner_admin_id, name, description, origin, trigger_kind, trigger_json, conditions_json,
        workflow_id, params_json, execution, valid_from, valid_until, max_executions, cooldown_ms, timezone, state, version, created_at, updated_at)
       VALUES (?,?,?,?, 'user', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?)`,
    ).run(
      id,
      adminId,
      data.name,
      data.description || "",
      data.trigger_kind,
      data.trigger_json || "{}",
      data.conditions_json || "[]",
      data.workflow_id || null,
      data.params_json || "{}",
      data.execution || "manual",
      data.valid_from || null,
      data.valid_until || null,
      data.max_executions ?? null,
      data.cooldown_ms ?? PR_LIMITS.default_cooldown_ms,
      data.timezone || "UTC",
      ts,
      ts,
    );
    assignNew("pr_rule", id, adminId);
    const row = db.prepare("SELECT * FROM pr_rules WHERE id = ?").get(id);
    db.prepare(
      "INSERT INTO pr_rule_versions (id, rule_id, version, snapshot_json, author_admin_id, created_at) VALUES (?,?,?,?,?,?)",
    ).run(uid(), id, 1, JSON.stringify(snapshotOf(row)), adminId, ts);
  });
  audit("pr.rule_created", { admin: adminId, ids: [id] });
  return getRule(adminId, id);
}

export function getRule(adminId, id) {
  if (!owns(adminId, "pr_rule", id)) return null;
  const r = db.prepare("SELECT * FROM pr_rules WHERE id = ?").get(id);
  if (!r) return null;
  return {
    ...ruleView(r),
    versions: db
      .prepare(
        "SELECT version, created_at, author_admin_id FROM pr_rule_versions WHERE rule_id = ? ORDER BY version",
      )
      .all(id),
  };
}

export function listRules(adminId, { state = null } = {}) {
  if (!adminId) return [];
  const rows = state
    ? db
        .prepare(
          "SELECT * FROM pr_rules WHERE owner_admin_id = ? AND state = ? ORDER BY created_at DESC",
        )
        .all(adminId, state)
    : db
        .prepare("SELECT * FROM pr_rules WHERE owner_admin_id = ? ORDER BY created_at DESC")
        .all(adminId);
  return rows.map(ruleView);
}

/** Edição com VERSIONAMENTO: nova versão + snapshot; execuções em curso não são alteradas. */
export function updateRule(adminId, id, body = {}) {
  const r = db.prepare("SELECT * FROM pr_rules WHERE id = ?").get(id);
  if (!r || !owns(adminId, "pr_rule", id)) return { error: "not_found" };
  const data = validateRuleBody(body, { partial: true });
  const merged = {
    ...ruleView(r),
    ...data,
    trigger: undefined,
    conditions: undefined,
    params: undefined,
  };
  // revalida gatilho/condições mescladas (edição parcial nunca deixa a regra inválida)
  if (body.trigger !== undefined || (data.trigger_kind && data.trigger_kind !== r.trigger_kind))
    merged.trigger_json = JSON.stringify(
      validateTrigger(data.trigger_kind || r.trigger_kind, body.trigger || {}),
    );
  if (body.conditions !== undefined) merged.conditions_json = JSON.stringify(body.conditions);
  const ts = now();
  const newVersion = r.version + 1;
  tx(() => {
    db.prepare(
      `UPDATE pr_rules SET name=?, description=?, trigger_kind=?, trigger_json=?, conditions_json=?, workflow_id=?,
        params_json=?, execution=?, valid_from=?, valid_until=?, max_executions=?, cooldown_ms=?, timezone=?, version=?, updated_at=?
       WHERE id=?`,
    ).run(
      clean(merged.name, 80),
      clean(merged.description, 1000),
      data.trigger_kind || r.trigger_kind,
      merged.trigger_json || r.trigger_json,
      merged.conditions_json || r.conditions_json,
      merged.workflow_id ?? r.workflow_id,
      merged.params_json || r.params_json,
      merged.execution || r.execution,
      merged.valid_from ?? r.valid_from,
      merged.valid_until ?? r.valid_until,
      merged.max_executions ?? r.max_executions,
      merged.cooldown_ms ?? r.cooldown_ms,
      data.timezone || r.timezone || "UTC",
      newVersion,
      ts,
      id,
    );
    const fresh = db.prepare("SELECT * FROM pr_rules WHERE id = ?").get(id);
    db.prepare(
      "INSERT INTO pr_rule_versions (id, rule_id, version, snapshot_json, author_admin_id, created_at) VALUES (?,?,?,?,?,?)",
    ).run(uid(), id, newVersion, JSON.stringify(snapshotOf(fresh)), adminId, ts);
  });
  audit("pr.rule_updated", { admin: adminId, ids: [id], version: newVersion });
  return getRule(adminId, id);
}

/** Transição de estado ATÔMICA (guarda r.changes — padrão do repo) respeitando o grafo. */
const TRANSITIONS = {
  draft: new Set(["active", "disabled"]),
  active: new Set(["paused", "disabled", "expired", "failed"]),
  paused: new Set(["active", "disabled", "expired"]),
  disabled: new Set(["draft"]),
  expired: new Set([]),
  failed: new Set(["draft", "disabled"]),
};
export function setRuleState(adminId, id, state, extra = {}) {
  if (!RULE_STATES.has(state)) throw new PrError("pr_invalid_state");
  const r = db.prepare("SELECT state FROM pr_rules WHERE id = ?").get(String(id));
  if (!r || !owns(adminId, "pr_rule", id)) return { error: "not_found" };
  if (!TRANSITIONS[r.state]?.has(state)) return { error: "pr_invalid_transition", from: r.state };
  const ts = now();
  const sets = ["state = ?", "updated_at = ?"];
  const vals = [state, ts];
  if (state === "active") {
    const rule = db
      .prepare("SELECT trigger_kind, trigger_json, timezone FROM pr_rules WHERE id = ?")
      .get(id);
    if (rule.trigger_kind === "temporal") {
      const next = computeNextRunAt(parseJson(rule.trigger_json, {}), {
        timezone: rule.timezone || "UTC",
      });
      if (next) {
        sets.push("next_run_at = ?");
        vals.push(next);
      }
    }
  }
  if (extra.lastError) {
    sets.push("last_error = ?");
    vals.push(clean(extra.lastError, 120));
  }
  db.prepare(`UPDATE pr_rules SET ${sets.join(", ")} WHERE id = ?`).run(...vals, id);
  audit("pr.rule_state", { admin: adminId, ids: [id], status: state });
  if (state === "paused")
    notify(
      adminId,
      "rule_paused",
      "normal",
      "proactive",
      "pr_rule",
      id,
      clean(extra.reason || "Regra pausada.", 200),
    );
  return getRule(adminId, id);
}

// ---------- inteligência temporal (Fase 8): timezone IANA + DST ----------

const TZ_FMT = new Map();
function tzFormatter(tz) {
  let f = TZ_FMT.get(tz);
  if (!f) {
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      TZ_FMT.set(tz, f);
    } catch {
      return null; // timezone inválida → chamador trata (fail-closed)
    }
  }
  return f;
}

function tzValidate(tz) {
  return typeof tz === "string" && tz !== "" && tzFormatter(tz) !== null;
}

/** Partes de parede (wall clock) de um instante num timezone IANA. */
function wallInTz(ms, tz) {
  const f = tzFormatter(tz);
  if (!f) return null;
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const hour = Number(p.hour) === 24 ? 0 : Number(p.hour); // Intl pode emitir '24'
  return { y: +p.year, mo: +p.month, d: +p.day, h: hour, mi: +p.minute, s: +p.second };
}

/**
 * Converte horário de parede local (ex.: "2026-11-05T09:00" em America/Sao_Paulo) para o
 * instante UTC correto, lidando com DST:
 *  - transição de outono (mesma hora local existe 2×): usa a PRIMEIRA ocorrência
 *    (padrão da janela adiantada — horário padrão);
 *  - transição de primavera (hora local NÃO existe): avança para o instante da
 *    transição + 1 h (a recorrência NÃO é perdida nem executada duas vezes — política
 *    documentada em docs/evolution/phase-8/timezone-dst.md).
 * Timezone inválida → null (fail-closed: o chamador registra e NÃO dispara).
 */
export function zonedWallToUtc(wall, tz) {
  if (!tzValidate(tz) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(String(wall || ""))) return null;
  const naive = Date.parse(`${wall}:00Z`);
  if (!Number.isFinite(naive)) return null;
  // Convergência: busca o instante t cujo offset(t) leva de naive ao MESMO t.
  let instant = naive;
  for (let i = 0; i < 3; i++) {
    const w = wallInTz(instant, tz);
    if (!w) return null;
    const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
    const next = naive - (asUtc - instant);
    if (next === instant) return new Date(instant); // ponto fixo (horário existe)
    instant = next;
  }
  // Não convergiu (oscilou): hora local NÃO existe (spring forward). Política documentada
  // (ADR IF-006): avança 1 h a partir do último candidato — determinístico, nunca perde
  // a ocorrência nem executa na hora inexistente.
  return new Date(instant + 3_600_000);
}

/**
 * Próxima ocorrência de um gatilho temporal no TIMEZONE do usuário (instantes sempre
 * persistidos em UTC; a hora local é preservada entre transições de DST). Recorrências:
 * daily, weekly (weekday único ou lista `weekdays`), monthly (dia fixo, com clamp ao
 * último dia do mês), interval, date — todas com `window` opcional {from,to} "HH:MM".
 * Retorna null quando não há próxima ocorrência calculável (fail-closed).
 */
export function computeNextRunAt(trigger, { from = new Date(), timezone = "UTC" } = {}) {
  if (!tzValidate(timezone)) return null;
  const base = new Date(from);
  const w = wallInTz(base.getTime(), timezone);
  if (!w) return null;
  const [hh, mm] = String(trigger.time || "00:00")
    .split(":")
    .map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  const wallOf = (y, mo, d) => `${y}-${pad(mo)}-${pad(d)}T${pad(hh)}:${pad(mm)}`;
  const plusDays = (y, mo, d, n) => {
    const t = new Date(Date.UTC(y, mo - 1, d + n));
    return { y: t.getUTCFullYear(), mo: t.getUTCMonth() + 1, d: t.getUTCDate() };
  };

  let wall = null;
  if (trigger.type === "daily") {
    const today = wallOf(w.y, w.mo, w.d);
    if (today > `${w.y}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}`) wall = today;
    else {
      const t = plusDays(w.y, w.mo, w.d, 1);
      wall = wallOf(t.y, t.mo, t.d);
    }
  } else if (trigger.type === "weekly") {
    const days =
      Array.isArray(trigger.weekdays) && trigger.weekdays.length
        ? trigger.weekdays
        : [trigger.weekday];
    if (!days.every((x) => Number.isInteger(x) && x >= 0 && x <= 6)) return null;
    for (let i = 0; i < 8 && !wall; i++) {
      const t = plusDays(w.y, w.mo, w.d, i);
      const dow = new Date(Date.UTC(t.y, t.mo - 1, t.d)).getUTCDay();
      if (!days.includes(dow)) continue;
      const cand = wallOf(t.y, t.mo, t.d);
      if (i > 0 || cand > `${w.y}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}`) wall = cand;
    }
  } else if (trigger.type === "monthly") {
    const day = trigger.day;
    if (!Number.isInteger(day) || day < 1 || day > 31) return null;
    for (let i = 0; i < 3 && !wall; i++) {
      const mo = ((w.mo - 1 + i) % 12) + 1;
      const y = w.y + Math.floor((w.mo - 1 + i) / 12);
      const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
      const d = Math.min(day, last); // clamp: 31 em mês de 30 → dia 30
      const cand = wallOf(y, mo, d);
      if (i > 0 || cand > `${w.y}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}`) wall = cand;
    }
  } else if (trigger.type === "interval") {
    return new Date(base.getTime() + trigger.intervalMs).toISOString();
  } else if (trigger.type === "date") {
    return zonedWallToUtc(`${trigger.date}T${pad(hh)}:${pad(mm)}`, timezone);
  } else return null;
  if (!wall) return null;
  const instant = zonedWallToUtc(wall, timezone);
  if (!instant) return null;
  // janela de horário: se a ocorrência cai fora da janela local, adia para o início da
  // janela no MESMO dia (ou no dia seguinte, se já passou) — motivo registrado pelo tick.
  if (trigger.window) {
    if (
      !/^\d{2}:\d{2}$/.test(String(trigger.window.from || "")) ||
      !/^\d{2}:\d{2}$/.test(String(trigger.window.to || ""))
    )
      return null;
    const [fh, fm] = trigger.window.from.split(":").map(Number);
    const [th, tm] = trigger.window.to.split(":").map(Number);
    const parts = wall.split("T")[1].split(":").map(Number);
    const mins = parts[0] * 60 + parts[1];
    const fromM = fh * 60 + fm;
    const toM = th * 60 + tm;
    if (mins < fromM || mins > toM) {
      const [y, mo, d] = wall.split("T")[0].split("-").map(Number);
      let targetWall = `${y}-${pad(mo)}-${pad(d)}T${pad(fh)}:${pad(fm)}`;
      if (mins > toM) {
        const t = plusDays(y, mo, d, 1);
        targetWall = `${t.y}-${pad(t.mo)}-${pad(t.d)}T${pad(fh)}:${pad(fm)}`;
      }
      const tInstant = zonedWallToUtc(targetWall, timezone);
      if (!tInstant) return null;
      return tInstant.toISOString();
    }
  }
  return instant.toISOString();
}

// ---------- eventos internos ----------

const recentEventTimes = new Map(); // owner -> [timestamps] (proteção a tempestade; processo local)

/**
 * Registra um evento interno AUTORIZADO (fonte da whitelist). Duplicados (mesma chave
 * idempotente) são descartados; tempestade é limitada por owner/minuto. O evento é DADO:
 * nunca instrução — o payload só alimenta condições e evidências.
 */
export function recordEvent(
  ownerAdminId,
  { source, kind, payload = {}, dedupeKey = null, at = null } = {},
) {
  if (!ownerAdminId) throw new PrError("pr_owner_required");
  if (!SOURCES.has(source)) throw new PrError("pr_invalid_source"); // fonte não registrada → descartado
  const k = clean(kind, 60);
  if (!k) throw new PrError("pr_invalid_kind");
  // tempestade: teto por owner/minuto
  const minuteAgo = Date.now() - 60_000;
  const times = (recentEventTimes.get(ownerAdminId) || []).filter((t) => t > minuteAgo);
  if (times.length >= PR_LIMITS.max_events_per_minute) throw new PrError("pr_event_storm");
  times.push(Date.now());
  recentEventTimes.set(ownerAdminId, times);
  try {
    const r = db
      .prepare(
        "INSERT INTO pr_events (owner_admin_id, source, kind, payload_json, dedupe_key, created_at) VALUES (?,?,?,?,?,?)",
      )
      .run(
        ownerAdminId,
        source,
        k,
        JSON.stringify(payload ?? {}),
        dedupeKey ? clean(dedupeKey, 200) : null,
        at || now(),
      );
    const event = {
      id: Number(r.lastInsertRowid),
      owner_admin_id: ownerAdminId,
      source,
      kind: k,
      payload: payload ?? {},
    };
    // Nota: UNIQUE(owner, dedupe_key) teria rejeitado a inserção acima.
    return { event, duplicate: false };
  } catch (e) {
    if (/UNIQUE constraint failed/.test(String(e.message))) {
      const row = db
        .prepare(
          "SELECT id, source, kind, payload_json, created_at FROM pr_events WHERE owner_admin_id = ? AND dedupe_key = ?",
        )
        .get(ownerAdminId, clean(dedupeKey, 200));
      return {
        event: row ? { ...row, payload: parseJson(row.payload_json, {}) } : null,
        duplicate: true,
      };
    }
    throw e;
  }
}

// ---------- oportunidades ----------

function notify(ownerAdminId, type, priority, source, entityType, entityId, title, body = "") {
  db.prepare(
    "INSERT INTO pr_notifications (id, owner_admin_id, type, priority, source, entity_type, entity_id, title, body, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
  ).run(
    uid(),
    ownerAdminId,
    type,
    priority,
    clean(source, 32),
    entityType || null,
    entityId || null,
    clean(title, 200),
    clean(body, 1000),
    now(),
  );
  // retenção: mantém apenas as N mais recentes por dono
  const count = db
    .prepare("SELECT COUNT(*) n FROM pr_notifications WHERE owner_admin_id = ?")
    .get(ownerAdminId).n;
  if (count > PR_LIMITS.max_notifications) {
    db.prepare(
      "DELETE FROM pr_notifications WHERE id IN (SELECT id FROM pr_notifications WHERE owner_admin_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?)",
    ).run(ownerAdminId, PR_LIMITS.max_notifications);
  }
}

/**
 * Regra disparada (evento interno OU gatilho temporal) → limites → condições →
 * oportunidade (nível ≥ 1) ou início automático (nível ≥ 2, execution=auto). Toda a
 * autorização real continua no Workflow Engine; aqui nunca há execução direta.
 */
export async function handleRuleTriggered(
  adminId,
  ruleId,
  { event = null, occurrenceKey = null, nowMs = Date.now() } = {},
) {
  const rule = db.prepare("SELECT * FROM pr_rules WHERE id = ?").get(String(ruleId));
  if (!rule || !owns(adminId, "pr_rule", ruleId)) return { error: "not_found" };
  if (rule.state !== "active") return { skipped: `rule_state_${rule.state}` };
  // validade
  if (rule.valid_until && rule.valid_until <= new Date(nowMs).toISOString()) {
    setRuleState(adminId, ruleId, "expired", { lastError: "pr_validity_ended" });
    return { skipped: "pr_validity_ended" };
  }
  const controls = getControls(adminId);
  if (controls.paused) return { skipped: "pr_paused" };
  if (controls.level === 0) return { skipped: "pr_level_observation" };

  // limites por regra: máximo total, cooldown, pendentes
  if (rule.max_executions !== null && rule.execution_count >= rule.max_executions) {
    setRuleState(adminId, ruleId, "disabled", { lastError: "pr_max_executions_reached" });
    notify(
      adminId,
      "limit_reached",
      "normal",
      "proactive",
      "pr_rule",
      ruleId,
      "Regra desativada: limite de execuções atingido.",
    );
    return { skipped: "pr_max_executions_reached" };
  }
  const pendingForRule = db
    .prepare(
      "SELECT COUNT(*) n FROM pr_opportunities WHERE rule_id = ? AND status IN ('detected','evaluating','recommended','snoozed','accepted','executing')",
    )
    .get(ruleId).n;
  if (pendingForRule >= PR_LIMITS.max_pending_per_rule) return { skipped: "pr_pending_limit" };

  // Idempotência ANTES de qualquer custo: a mesma ocorrência nunca produz duas oportunidades
  // (replay de evento / tick duplicado / retentativa). Depois disso, cooldown.
  const dedupeKey = occurrenceKey ? `pr:opp:${ruleId}:${clean(occurrenceKey, 120)}` : null;
  if (dedupeKey) {
    const dup = db.prepare("SELECT id FROM pr_opportunities WHERE dedupe_key = ?").get(dedupeKey);
    if (dup) return { skipped: "pr_duplicate", opportunityId: dup.id };
  }
  if (
    rule.cooldown_ms > 0 &&
    rule.last_run_at &&
    nowMs - Date.parse(rule.last_run_at) < rule.cooldown_ms
  )
    return { skipped: "pr_cooldown" };

  // condições (falha registrada — nunca autoriza)
  const facts = event?.payload ?? {};
  const cond = evaluateConditions(parseJson(rule.conditions_json, []), facts);
  if (!cond.ok) {
    return { skipped: "pr_conditions_not_met", reasons: cond.reasons };
  }

  // janela horária (limite global de execução por hora, por regra)
  const hourAgo = new Date(nowMs - 3_600_000).toISOString();
  const lastHour = db
    .prepare(
      "SELECT COUNT(*) n FROM pr_opportunities WHERE rule_id = ? AND created_at > ? AND status IN ('accepted','executing','completed')",
    )
    .get(ruleId, hourAgo).n;
  if (lastHour >= controls.maxExecutionsPerHour) {
    notify(
      adminId,
      "limit_reached",
      "normal",
      "proactive",
      "pr_rule",
      ruleId,
      "Limite horário de execuções atingido.",
    );
    return { skipped: "pr_rate_limit" };
  }

  // teto global de oportunidades pendentes do dono
  const pendingOwner = db
    .prepare(
      "SELECT COUNT(*) n FROM pr_opportunities WHERE owner_admin_id = ? AND status IN ('detected','evaluating','recommended','snoozed')",
    )
    .get(adminId).n;
  if (pendingOwner >= controls.maxPendingOpportunities) {
    notify(
      adminId,
      "limit_reached",
      "high",
      "proactive",
      null,
      null,
      "Muitas oportunidades pendentes — resolva ou descarte antes.",
    );
    return { skipped: "pr_pending_owner_limit" };
  }

  const justification = clean(
    event
      ? `Evento ${event.kind} (fonte ${event.source}) corresponde ao gatilho da regra "${rule.name}" e satisfez ${cond.evaluated} condição(ões).`
      : `Gatilho temporal (${parseJson(rule.trigger_json, {}).type || "agenda"}) da regra "${rule.name}" venceu.`,
    PR_LIMITS.max_justification_chars,
  );

  // Nível 2/3 + execution=auto + workflow → início AUTOMÁTICO (via startWorkflowRun:
  // políticas + D9 nativos; sem atalho). Caso contrário → recomendação humana.
  const auto = controls.level >= 2 && rule.execution === "auto" && rule.workflow_id;
  const ts = now();
  const oppId = uid();
  db.prepare(
    `INSERT INTO pr_opportunities (id, owner_admin_id, rule_id, event_id, rule_version, kind, priority, justification,
      evidence_json, dedupe_key, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?, ?, ?)`,
  ).run(
    oppId,
    adminId,
    ruleId,
    event?.id || null,
    rule.version,
    clean(event?.kind || "temporal_due", 60),
    "normal",
    justification,
    JSON.stringify([
      {
        type: "event",
        id: event?.id || null,
        source: event?.source || "temporal",
        kind: event?.kind || rule.trigger_kind,
      },
      { type: "conditions", result: cond.ok, evaluated: cond.evaluated },
    ]),
    dedupeKey,
    auto ? "accepted" : "recommended",
    ts,
    ts,
  );

  db.prepare("UPDATE pr_rules SET last_run_at = ?, updated_at = ? WHERE id = ?").run(
    new Date(nowMs).toISOString(),
    ts,
    ruleId,
  );

  if (auto) {
    const out = await startAuto(adminId, oppId, controls);
    return { opportunityId: oppId, auto: true, ...out };
  }
  notify(
    adminId,
    "opportunity_identified",
    "normal",
    "proactive",
    "pr_opportunity",
    oppId,
    `Oportunidade: ${rule.name}`,
    justification,
  );
  audit("pr.opportunity_recommended", { admin: adminId, ids: [oppId] });
  return { opportunityId: oppId, auto: false };
}

/** Início automático do workflow da oportunidade — SEMPRE via startWorkflowRun (políticas). */
async function startAuto(adminId, opportunityId, controls) {
  const opp = db.prepare("SELECT * FROM pr_opportunities WHERE id = ?").get(opportunityId);
  const rule = db.prepare("SELECT * FROM pr_rules WHERE id = ?").get(opp.rule_id);
  const out = await startWorkflowRun(adminId, rule.workflow_id, {
    objective: `[proativa] ${rule.name}`,
    idempotencyKey: `pr-opp:${opportunityId}`,
  });
  if (out.error) {
    db.prepare(
      "UPDATE pr_opportunities SET status='failed', decision_json=?, updated_at=? WHERE id=?",
    ).run(JSON.stringify({ error: out.error }), now(), opportunityId);
    notify(
      adminId,
      "execution_failed",
      "high",
      "proactive",
      "pr_opportunity",
      opportunityId,
      `Automação bloqueada: ${out.error}`,
    );
    return { started: false, error: out.error };
  }
  db.prepare(
    "UPDATE pr_opportunities SET status='executing', workflow_run_id=?, updated_at=? WHERE id=?",
  ).run(out.run.id, now(), opportunityId);
  db.prepare("UPDATE pr_rules SET execution_count = execution_count + 1 WHERE id = ?").run(rule.id);
  notify(
    adminId,
    "routine_started",
    "normal",
    "proactive",
    "pr_workflow_run",
    out.run.id,
    `Rotina iniciada: ${rule.name}`,
  );
  audit("pr.auto_started", { admin: adminId, ids: [opportunityId], correlation: out.run.id });
  return { started: true, runId: out.run.id };
}

export function listOpportunities(adminId, { status = null, limit = 100 } = {}) {
  if (!adminId) return [];
  const rows = status
    ? db
        .prepare(
          "SELECT * FROM pr_opportunities WHERE owner_admin_id = ? AND status = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(adminId, status, Math.min(limit, 200))
    : db
        .prepare(
          "SELECT * FROM pr_opportunities WHERE owner_admin_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(adminId, Math.min(limit, 200));
  return rows.map((o) => ({
    ...o,
    evidence: parseJson(o.evidence_json, []),
    decision: parseJson(o.decision_json, null),
  }));
}

export function getOpportunity(adminId, id) {
  const o = db.prepare("SELECT * FROM pr_opportunities WHERE id = ?").get(String(id));
  return o && o.owner_admin_id === adminId
    ? { ...o, evidence: parseJson(o.evidence_json, []), decision: parseJson(o.decision_json, null) }
    : null;
}

/** Aceite HUMANO: inicia o workflow pelas políticas normais (nível ≥ 1; nunca automático). */
export async function acceptOpportunity(adminId, id) {
  const opp = getOpportunity(adminId, id);
  if (!opp) return { error: "not_found" };
  if (!["recommended", "snoozed", "detected"].includes(opp.status))
    return { error: "pr_opportunity_not_acceptable" };
  const controls = getControls(adminId);
  if (controls.level === 0) return { error: "pr_level_observation" };
  const rule = db.prepare("SELECT * FROM pr_rules WHERE id = ?").get(opp.rule_id);
  if (!rule?.workflow_id) return { error: "pr_no_workflow" };
  db.prepare(
    "UPDATE pr_opportunities SET status='accepted', decision_json=?, updated_at=? WHERE id=?",
  ).run(
    JSON.stringify({ acceptedBy: adminId, at: now() }), // decisão humana registrada
    now(),
    id,
  );
  const out = await startWorkflowRun(adminId, rule.workflow_id, {
    objective: `[proativa] ${rule.name}`,
    idempotencyKey: `pr-opp:${id}`,
  });
  if (out.error) {
    db.prepare(
      "UPDATE pr_opportunities SET status='failed', decision_json=?, updated_at=? WHERE id=?",
    ).run(JSON.stringify({ error: out.error, acceptedBy: adminId }), now(), id);
    return { error: out.error };
  }
  db.prepare(
    "UPDATE pr_opportunities SET status='executing', workflow_run_id=?, updated_at=? WHERE id=?",
  ).run(out.run.id, now(), id);
  db.prepare("UPDATE pr_rules SET execution_count = execution_count + 1 WHERE id = ?").run(rule.id);
  notify(
    adminId,
    "routine_started",
    "normal",
    "proactive",
    "pr_workflow_run",
    out.run.id,
    `Rotina iniciada: ${rule.name}`,
  );
  audit("pr.opportunity_accepted", { admin: adminId, ids: [id], correlation: out.run.id });
  return { opportunity: getOpportunity(adminId, id), runId: out.run.id };
}

export function dismissOpportunity(adminId, id, { reason = "" } = {}) {
  const opp = getOpportunity(adminId, id);
  if (!opp) return { error: "not_found" };
  if (!["recommended", "snoozed", "detected"].includes(opp.status))
    return { error: "pr_opportunity_not_dismissable" };
  db.prepare(
    "UPDATE pr_opportunities SET status='dismissed', decision_json=?, updated_at=? WHERE id=?",
  ).run(JSON.stringify({ dismissedBy: adminId, reason: clean(reason, 300), at: now() }), now(), id);
  audit("pr.opportunity_dismissed", { admin: adminId, ids: [id] });
  return getOpportunity(adminId, id);
}

export function snoozeOpportunity(adminId, id, { untilMs = 3_600_000 } = {}) {
  const opp = getOpportunity(adminId, id);
  if (!opp) return { error: "not_found" };
  if (!["recommended", "snoozed", "detected"].includes(opp.status))
    return { error: "pr_opportunity_not_snoozable" };
  const until = new Date(
    Date.now() + Math.min(Math.max(Number(untilMs) || 3_600_000, 60_000), 7 * 86_400_000),
  ).toISOString();
  db.prepare(
    "UPDATE pr_opportunities SET status='snoozed', snoozed_until=?, updated_at=? WHERE id=?",
  ).run(until, now(), id);
  return getOpportunity(adminId, id);
}

// ---------- notificações ----------

export function listNotifications(adminId, { unreadOnly = false, limit = 100 } = {}) {
  if (!adminId) return [];
  const rows = unreadOnly
    ? db
        .prepare(
          "SELECT * FROM pr_notifications WHERE owner_admin_id = ? AND read_at IS NULL ORDER BY created_at DESC LIMIT ?",
        )
        .all(adminId, Math.min(limit, 200))
    : db
        .prepare(
          "SELECT * FROM pr_notifications WHERE owner_admin_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(adminId, Math.min(limit, 200));
  return rows;
}

export function markNotificationRead(adminId, id) {
  const n = db
    .prepare("SELECT id FROM pr_notifications WHERE id = ? AND owner_admin_id = ?")
    .get(String(id), adminId);
  if (!n) return { error: "not_found" };
  db.prepare("UPDATE pr_notifications SET read_at = ? WHERE id = ?").run(now(), id);
  return { ok: true };
}

export function dismissNotification(adminId, id) {
  const n = db
    .prepare("SELECT id FROM pr_notifications WHERE id = ? AND owner_admin_id = ?")
    .get(String(id), adminId);
  if (!n) return { error: "not_found" };
  db.prepare("DELETE FROM pr_notifications WHERE id = ?").run(id);
  return { ok: true };
}

// ---------- teste sem efeitos colaterais / execução manual ----------

/** Teste de regra: avalia condições contra fatos de amostra e diz o que ACONTECERIA — sem efeitos. */
export function testRule(adminId, ruleId, sampleFacts = {}) {
  const r = db.prepare("SELECT * FROM pr_rules WHERE id = ?").get(String(ruleId));
  if (!r || !owns(adminId, "pr_rule", String(ruleId))) return { error: "not_found" };
  const cond = evaluateConditions(parseJson(r.conditions_json, []), sampleFacts);
  const controls = getControls(adminId);
  return {
    wouldTrigger: r.state === "active" && cond.ok && !controls.paused && controls.level > 0,
    conditionsMet: cond.ok,
    reasons: cond.reasons,
    evaluated: cond.evaluated,
    wouldAutoStart: controls.level >= 2 && r.execution === "auto" && !!r.workflow_id,
    note: "Teste SEM efeitos colaterais: nenhuma oportunidade ou execução foi criada.",
  };
}

/** Execução MANUAL: mesmo caminho das automáticas (limites, condições, políticas). */
export async function runRuleManually(adminId, ruleId) {
  return handleRuleTriggered(adminId, ruleId, { occurrenceKey: `manual:${uid()}` });
}

/** Eventos internos recentes do dono (observabilidade; conteúdo é dado não confiável). */
export function listEvents(adminId, { limit = 100 } = {}) {
  if (!adminId) return [];
  return db
    .prepare(
      "SELECT id, source, kind, payload_json, dedupe_key, created_at FROM pr_events WHERE owner_admin_id = ? ORDER BY id DESC LIMIT ?",
    )
    .all(adminId, Math.min(Math.max(Number(limit) || 100, 1), 500))
    .map((e) => ({ ...e, payload: parseJson(e.payload_json, {}) }));
}

// ---------- tick, recuperação e observabilidade ----------

/**
 * Tick durável: gatilhos temporais vencidos, regras expiradas, snoozes vencidos,
 * reconciliação de oportunidades em execução com evidência do run.
 */
export async function tickProactive({ nowMs = Date.now() } = {}) {
  const tsIso = new Date(nowMs).toISOString();
  const out = {
    temporalFired: 0,
    expiredRules: 0,
    snoozesWoke: 0,
    reconciled: 0,
    notificationsExpired: 0,
  };

  // regras temporais ativas vencidas (next_run_at persistido — nada só em memória).
  // Fase 8: ocorrência no TIMEZONE do usuário; drift controlado com política explícita.
  const due = db
    .prepare(
      "SELECT id, owner_admin_id, trigger_json, timezone, next_run_at FROM pr_rules WHERE state = 'active' AND trigger_kind = 'temporal' AND next_run_at IS NOT NULL AND next_run_at <= ?",
    )
    .all(tsIso);
  for (const r of due) {
    const trigger = parseJson(r.trigger_json, {});
    const tz = r.timezone || "UTC";
    const dueMs = Date.parse(r.next_run_at);
    // Drift: ocorrência atrasada além do teto é DESCARTADA com motivo (nunca executada
    // tarde nem silenciosamente perdida); próxima ocorrência é agendada.
    if (nowMs - dueMs > PR_LIMITS.max_occurrence_delay_ms) {
      const next = computeNextRunAt(trigger, { from: new Date(nowMs + 1000), timezone: tz });
      const wall = wallInTz(dueMs, tz);
      audit("pr.occurrence_skipped", {
        admin: r.owner_admin_id,
        ids: [r.id],
        reason: "pr_occurrence_stale",
        wall: wall
          ? `${wall.y}-${String(wall.mo).padStart(2, "0")}-${String(wall.d).padStart(2, "0")}T${String(wall.h).padStart(2, "0")}:${String(wall.mi).padStart(2, "0")}`
          : null,
      });
      if (trigger.type === "date") {
        db.prepare(
          "UPDATE pr_rules SET state='expired', next_run_at=NULL, updated_at=? WHERE id=?",
        ).run(now(), r.id);
      } else {
        db.prepare("UPDATE pr_rules SET next_run_at = ?, updated_at = ? WHERE id = ?").run(
          next,
          now(),
          r.id,
        );
      }
      continue;
    }
    // Chave de ocorrência = horário LOCAL da ocorrência vencida (estável entre ticks; DST-
    // seguro: 09:00 local continua 09:00 quando o offset muda).
    const w = wallInTz(dueMs, tz) || { y: 0, mo: 0, d: 0, h: 0, mi: 0 };
    const pad = (n) => String(n).padStart(2, "0");
    const occurrence = `tick:${w.y}-${pad(w.mo)}-${pad(w.d)}T${pad(w.h)}:${pad(w.mi)}@${tz}`;
    // agenda a próxima a partir da ocorrência vencida (sem drift cumulativo)
    const next = computeNextRunAt(trigger, { from: new Date(dueMs + 1000), timezone: tz });
    const res = await handleRuleTriggered(r.owner_admin_id, r.id, {
      occurrenceKey: occurrence,
      nowMs,
    });
    if (!res.error && !res.skipped) out.temporalFired++;
    if (trigger.type === "date") {
      db.prepare(
        "UPDATE pr_rules SET state='expired', next_run_at=NULL, updated_at=? WHERE id=?",
      ).run(now(), r.id);
    } else {
      db.prepare("UPDATE pr_rules SET next_run_at = ?, updated_at = ? WHERE id = ?").run(
        next,
        now(),
        r.id,
      );
    }
  }

  // expiração por validade
  const toExpire = db
    .prepare(
      "SELECT id, owner_admin_id FROM pr_rules WHERE state = 'active' AND valid_until IS NOT NULL AND valid_until <= ?",
    )
    .all(tsIso);
  for (const r of toExpire) {
    setRuleState(r.owner_admin_id, r.id, "expired", { lastError: "pr_validity_ended" });
    out.expiredRules++;
  }

  // snoozes vencidos voltam a 'recommended'
  const woke = db
    .prepare(
      "UPDATE pr_opportunities SET status='recommended', updated_at=? WHERE status='snoozed' AND snoozed_until <= ?",
    )
    .run(tsIso, tsIso);
  out.snoozesWoke = Number(woke.changes);

  // reconciliação: oportunidades 'executing' com run terminal → evidência do run decide
  const executing = db
    .prepare(
      "SELECT id, owner_admin_id, workflow_run_id FROM pr_opportunities WHERE status = 'executing' AND workflow_run_id IS NOT NULL",
    )
    .all();
  for (const o of executing) {
    const run = db.prepare("SELECT status FROM wf_runs WHERE id = ?").get(o.workflow_run_id);
    if (!run) continue;
    if (run.status === "completed") {
      db.prepare("UPDATE pr_opportunities SET status='completed', updated_at=? WHERE id=?").run(
        now(),
        o.id,
      );
      notify(
        o.owner_admin_id,
        "execution_completed",
        "normal",
        "proactive",
        "pr_opportunity",
        o.id,
        "Execução proativa concluída.",
      );
      out.reconciled++;
    } else if (run.status === "failed" || run.status === "cancelled") {
      db.prepare("UPDATE pr_opportunities SET status='failed', updated_at=? WHERE id=?").run(
        now(),
        o.id,
      );
      notify(
        o.owner_admin_id,
        "execution_failed",
        "high",
        "proactive",
        "pr_opportunity",
        o.id,
        `Execução proativa ${run.status === "failed" ? "falhou" : "foi cancelada"}.`,
      );
      out.reconciled++;
    }
  }

  // notificações expiradas saem da lista
  db.prepare("DELETE FROM pr_notifications WHERE expires_at IS NOT NULL AND expires_at <= ?").run(
    tsIso,
  );

  // expira oportunidades pendentes com validade vencida
  db.prepare(
    "UPDATE pr_opportunities SET status='expired', updated_at=? WHERE status IN ('detected','evaluating','recommended') AND expires_at IS NOT NULL AND expires_at <= ?",
  ).run(now(), tsIso);
  return out;
}

/** Boot: oportunidades em execução são reconciliadas pelo tick; nada fica órfão para sempre. */
export function recoverProactive() {
  // contadores para auditoria de boot
  const executing = db
    .prepare("SELECT COUNT(*) n FROM pr_opportunities WHERE status = 'executing'")
    .get().n;
  if (executing) audit("pr.recovered_executing", { count: executing });
  return { executing };
}

/** Correlação completa: event → rule → opportunity → run → approvals → resultado. */
export function getExecutionTrail(adminId, opportunityId) {
  const opp = getOpportunity(adminId, opportunityId);
  if (!opp) return null;
  let run = null;
  let approvals = [];
  if (opp.workflow_run_id && owns(adminId, "wf_run", opp.workflow_run_id)) {
    run = getWfRun(adminId, opp.workflow_run_id);
    approvals = db
      .prepare(
        "SELECT approval_id, node_id, status FROM wf_node_executions WHERE run_id = ? AND approval_id IS NOT NULL",
      )
      .all(opp.workflow_run_id);
  }
  return { opportunity: opp, run, approvals };
}

/** Métricas reais (contagens do banco — nada inventado). */
export function getMetrics(adminId) {
  if (!adminId) return null;
  const c = (sql, ...args) => db.prepare(sql).get(...args).n;
  return {
    events_received: c("SELECT COUNT(*) n FROM pr_events WHERE owner_admin_id = ?", adminId),
    opportunities_produced: c(
      "SELECT COUNT(*) n FROM pr_opportunities WHERE owner_admin_id = ?",
      adminId,
    ),
    opportunities_accepted: c(
      "SELECT COUNT(*) n FROM pr_opportunities WHERE owner_admin_id = ? AND status IN ('accepted','executing','completed')",
      adminId,
    ),
    workflows_started: c(
      "SELECT COUNT(*) n FROM pr_opportunities WHERE owner_admin_id = ? AND workflow_run_id IS NOT NULL",
      adminId,
    ),
    executions_completed: c(
      "SELECT COUNT(*) n FROM pr_opportunities WHERE owner_admin_id = ? AND status = 'completed'",
      adminId,
    ),
    executions_failed: c(
      "SELECT COUNT(*) n FROM pr_opportunities WHERE owner_admin_id = ? AND status = 'failed'",
      adminId,
    ),
    duplicates_blocked: c(
      "SELECT COUNT(*) n FROM pr_events WHERE owner_admin_id = ? AND dedupe_key IS NOT NULL",
      adminId,
    ),
    rules_active: c(
      "SELECT COUNT(*) n FROM pr_rules WHERE owner_admin_id = ? AND state = 'active'",
      adminId,
    ),
    notifications_unread: c(
      "SELECT COUNT(*) n FROM pr_notifications WHERE owner_admin_id = ? AND read_at IS NULL",
      adminId,
    ),
  };
}

// ---------- sink de eventos do Workflow Engine (inversão de dependência — sem ciclo) ----------

/** Chamado pelo index.js no boot: workflow.js → sink → eventos pr + gatilhos de regras. */
export function registerWorkflowEventSink() {
  setWfEventSink((e) => {
    try {
      const owner = db
        .prepare("SELECT owner_admin_id FROM wf_runs WHERE id = ?")
        .get(e.runId)?.owner_admin_id;
      if (!owner) return;
      const INTERESTING = new Set([
        "created",
        "completed",
        "failed",
        "timeout",
        "cancelled",
        "approval_pending",
        "approval_resolved",
      ]);
      if (!INTERESTING.has(e.kind)) return;
      const res = recordEvent(owner, {
        source: "workflow",
        kind: `wf_${e.kind}`,
        payload: { run_id: e.runId, node_id: e.nodeId, ...e.detail },
        dedupeKey:
          e.kind === "created"
            ? `wf:${e.runId}:created`
            : `wf:${e.runId}:${e.kind}:${e.nodeId || "-"}:${e.at || ""}`,
      });
      if (res.duplicate || !res.event) return;
      // Aprovação D9 pendente em run proativo → notificação de alta prioridade (§13).
      if (e.kind === "approval_pending")
        notify(
          owner,
          "approval_needed",
          "high",
          "proactive",
          "pr_workflow_run",
          e.runId,
          "Aprovação humana necessária (D9).",
        );
      // regras de evento que escutam este kind
      const rules = db
        .prepare(
          "SELECT id, trigger_json FROM pr_rules WHERE owner_admin_id = ? AND state = 'active' AND trigger_kind = 'event'",
        )
        .all(owner);
      for (const r of rules) {
        const trigger = parseJson(r.trigger_json, {});
        if (trigger.source === "workflow" && trigger.eventKind === `wf_${e.kind}`)
          handleRuleTriggered(owner, r.id, { event: res.event }).catch(() => {});
      }
    } catch {
      // sink nunca derruba o workflow (eventos são best-effort)
    }
  });
}

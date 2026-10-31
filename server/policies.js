// Policy Engine — evolução Fase 3 (docs/evolution/phase-3/policy-engine.md).
// Políticas comportamentais versionadas, avaliadas no backend, DETERMINÍSTICAS (sem eval de
// código). Complementam — nunca substituem nem contornam — a autorização existente (can(),
// callTool, D9, ownership). Fail-closed: condição inválida → DENY auditado.
//
// Decisões: ALLOW | DENY | REQUIRE_APPROVAL. DENY prevalece (avaliado primeiro).
// REQUIRE_APPROVAL aplica-se a ferramentas com caminho D9; ferramentas sem suporte são
// negadas com código explícito (nunca autorizadas — ADR-WF-002).
import { db, now, uid, audit } from "./db.js";
import { assignNew, owns, dropOwnership, tx } from "./ownership.js";
import { TOOL_DEFS } from "./tools.js";

const EFFECTS = new Set(["allow", "deny", "require_approval"]);
const SCOPES_KIND = new Set(["tool", "workflow", "agent"]);
const OPS = new Set(["eq", "ne", "in", "not_in", "exists"]);

// Ferramentas cujo fluxo nativo enfileira aprovação humana (D9) quando exigido.
const D9_CAPABLE_TOOLS = new Set([
  "run_command",
  "cli_agent",
  "send_email",
  "agentmail_send_email",
  "openhands_task",
  "rea_analyze",
  "browser_action",
]);

const parseJson = (t, f) => {
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" ? v : f;
  } catch {
    return f;
  }
};

// ---------- validação ----------

/** Valida condições: [{field, op, value?}] — retorna lista de erros (vazia = válidas). */
export function validateConditions(conditions) {
  if (!Array.isArray(conditions)) return ["conditions_not_array"];
  const errors = [];
  for (const [i, c] of conditions.entries()) {
    if (!c || typeof c !== "object" || Array.isArray(c)) {
      errors.push(`condition_${i}_not_object`);
      continue;
    }
    if (typeof c.field !== "string" || !/^[a-z_]{1,40}$/.test(c.field))
      errors.push(`condition_${i}_field_invalid`);
    if (!OPS.has(c.op)) errors.push(`condition_${i}_op_invalid`);
    if (c.op === "in" || c.op === "not_in") {
      if (!Array.isArray(c.value) || !c.value.length) errors.push(`condition_${i}_value_not_list`);
    } else if (c.op !== "exists" && c.value === undefined) {
      errors.push(`condition_${i}_value_missing`);
    }
  }
  return errors;
}

function policyValid(body) {
  const errors = [];
  if (typeof body.name !== "string" || body.name.trim().length < 1 || body.name.length > 80)
    errors.push("name_invalid");
  if (!SCOPES_KIND.has(body.scope)) errors.push("scope_invalid");
  if (!EFFECTS.has(body.effect)) errors.push("effect_invalid");
  if (body.scope === "tool" && body.target !== "*" && !Object.hasOwn(TOOL_DEFS, body.target))
    errors.push("target_not_a_tool");
  if (
    body.scope !== "tool" &&
    body.target !== "*" &&
    !/^[a-zA-Z0-9_-]{1,80}$/.test(String(body.target))
  )
    errors.push("target_invalid");
  errors.push(...validateConditions(body.conditions).map((e) => `conditions_${e}`));
  return errors;
}

const policyRow = (r) =>
  r && {
    ...r,
    enabled: !!r.enabled,
    conditions: parseJson(r.conditions, []),
  };

// ---------- cache (invalidado em mutação; chave inclui adminId) ----------

const cache = new Map(); // adminId -> { loadedAt, policies }
const invalidate = (adminId) => cache.delete(adminId);

function policiesFor(adminId, kind) {
  const hit = cache.get(adminId);
  const list =
    hit?.policies ||
    db
      .prepare("SELECT * FROM wf_policies WHERE owner_admin_id = ? AND enabled = 1")
      .all(adminId)
      .map(policyRow);
  if (!hit) cache.set(adminId, { policies: list });
  return list.filter((p) => p.scope === kind);
}

// ---------- avaliação ----------

/** Avalia UMA condição sobre o contexto plano. Condição nunca lê código. */
function conditionMatches(cond, context) {
  const actual = context[cond.field];
  switch (cond.op) {
    case "eq":
      return actual === cond.value;
    case "ne":
      return actual !== cond.value;
    case "in":
      return Array.isArray(cond.value) && cond.value.includes(actual);
    case "not_in":
      return Array.isArray(cond.value) && !cond.value.includes(actual);
    case "exists":
      return actual !== undefined && actual !== null;
    default:
      return false;
  }
}

/**
 * Avalia as políticas do admin para o contexto. Determinístico: ordem por precedência
 * (deny > require_approval > allow; entre pares, priority DESC, depois created_at).
 * Nenhuma política correspondente → { decision: "allow", matched: null } — o engine
 * COMPLEMENTA a autorização (can()/D9/ownership), nunca concede o que ela nega.
 */
export function evaluatePolicies(adminId, context = {}) {
  if (!adminId) return { decision: "allow", matched: null };
  const kind = context.kind || "tool";
  const policies = policiesFor(adminId, kind).filter(
    (p) => p.target === "*" || p.target === context.target,
  );
  const order = { deny: 0, require_approval: 1, allow: 2 };
  const sorted = [...policies].sort(
    (a, b) =>
      order[a.effect] - order[b.effect] ||
      b.priority - a.priority ||
      (a.created_at < b.created_at ? -1 : 1),
  );
  for (const p of sorted) {
    // Fail-closed: condição inválida → DENY auditado (nunca allow). Valida ANTES do skip de
    // listas vazias — condições corrompidas (não-array) nunca passam como "sem condições".
    const invalid = validateConditions(p.conditions);
    if (invalid.length) {
      audit("policy.fail_closed", { admin: adminId, policy: p.id, status: "invalid_conditions" });
      return { decision: "deny", matched: p.id, reason: "policy_invalid_conditions" };
    }
    if (!p.conditions.length) continue; // política sem condições não casa nada (não é catch-all)
    if (p.conditions.every((c) => conditionMatches(c, context))) {
      audit("policy.evaluated", {
        admin: adminId,
        policy: p.id,
        status: p.effect,
        type: kind,
      });
      return { decision: p.effect, matched: p.id, reason: "policy_match" };
    }
  }
  return { decision: "allow", matched: null };
}

// ---------- administração ----------

export function createPolicy(adminId, body = {}) {
  if (!adminId) throw new Error("policy_owner_required");
  const errors = policyValid(body);
  if (errors.length) throw new Error(errors[0]);
  const id = uid();
  const ts = now();
  const conditions = Array.isArray(body.conditions) ? body.conditions : [];
  tx(() => {
    db.prepare(
      `INSERT INTO wf_policies
         (id, owner_admin_id, name, description, version, priority, scope, target, conditions, effect, enabled, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      adminId,
      body.name.trim(),
      String(body.description || "").slice(0, 2000),
      1,
      Number(body.priority) || 0,
      body.scope,
      body.target || "*",
      JSON.stringify(conditions),
      body.effect,
      body.enabled === false ? 0 : 1,
      ts,
      ts,
    );
    assignNew("wf_policy", id, adminId);
    db.prepare(
      "INSERT INTO wf_policy_revisions (id, policy_id, version, snapshot, created_at) VALUES (?,?,?,?,?)",
    ).run(uid(), id, 1, JSON.stringify({ ...body, conditions }), ts);
  });
  invalidate(adminId);
  audit("policy.created", { admin: adminId, ids: [id], status: body.effect });
  return getPolicy(adminId, id);
}

export function listPolicies(adminId) {
  return db
    .prepare(
      "SELECT * FROM wf_policies WHERE owner_admin_id = ? ORDER BY priority DESC, created_at",
    )
    .all(adminId)
    .map(policyRow);
}

export function getPolicy(adminId, id) {
  if (!owns(adminId, "wf_policy", id)) return null;
  return policyRow(db.prepare("SELECT * FROM wf_policies WHERE id = ?").get(id));
}

export function updatePolicy(adminId, id, body = {}) {
  if (!owns(adminId, "wf_policy", id)) return null;
  const existing = getPolicy(adminId, id);
  const merged = {
    name: body.name ?? existing.name,
    scope: body.scope ?? existing.scope,
    effect: body.effect ?? existing.effect,
    target: body.target ?? existing.target,
    conditions: body.conditions ?? existing.conditions,
  };
  const errors = policyValid(merged);
  if (errors.length) throw new Error(errors[0]);
  const ts = now();
  tx(() => {
    db.prepare(
      `UPDATE wf_policies SET name=?, description=COALESCE(?, description), version=version+1,
         priority=COALESCE(?, priority), scope=?, target=?, conditions=?, effect=?,
         enabled=COALESCE(?, enabled), updated_at=? WHERE id=? AND owner_admin_id=?`,
    ).run(
      merged.name.trim(),
      body.description !== undefined ? String(body.description).slice(0, 2000) : null,
      body.priority !== undefined ? Number(body.priority) || 0 : null,
      merged.scope,
      merged.target,
      JSON.stringify(merged.conditions),
      merged.effect,
      body.enabled !== undefined ? (body.enabled ? 1 : 0) : null,
      ts,
      id,
      adminId,
    );
    const version = db.prepare("SELECT version FROM wf_policies WHERE id=?").get(id).version;
    db.prepare(
      "INSERT INTO wf_policy_revisions (id, policy_id, version, snapshot, created_at) VALUES (?,?,?,?,?)",
    ).run(uid(), id, version, JSON.stringify(merged), ts);
  });
  invalidate(adminId);
  audit("policy.updated", { admin: adminId, ids: [id], status: merged.effect });
  return getPolicy(adminId, id);
}

export function deletePolicy(adminId, id) {
  if (!owns(adminId, "wf_policy", id)) return false;
  tx(() => {
    db.prepare("DELETE FROM wf_policies WHERE id = ?").run(id);
    dropOwnership("wf_policy", id);
  });
  invalidate(adminId);
  audit("policy.deleted", { admin: adminId, ids: [id] });
  return true;
}

/** Resultado para uma chamada de ferramenta (usado por callTool). */
export function toolPolicyVerdict(adminId, { tool, scope, principal }) {
  const context = {
    kind: "tool",
    target: tool,
    tool,
    scope,
    agent: principal?.botId || principal?.tokenId || null,
    admin: adminId,
  };
  const v = evaluatePolicies(adminId, context);
  if (v.decision === "allow") return v;
  if (v.decision === "require_approval") {
    if (D9_CAPABLE_TOOLS.has(tool)) return { ...v, decision: "allow", force_approval: true };
    return { decision: "deny", matched: v.matched, reason: "tool_has_no_approval_path" };
  }
  return v;
}

/** Invalida o cache de políticas (mutações fora da API — ex. correção operacional no banco). */
export function invalidatePolicyCache(adminId = null) {
  if (adminId) cache.delete(adminId);
  else cache.clear();
}

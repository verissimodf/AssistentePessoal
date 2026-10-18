// Local SQLite storage (node:sqlite, zero native deps). Everything lives in ./data.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { migrate } from "./migrations.js";
import { createAuth } from "./auth.js";

export const DATA_DIR = process.env.JARVIS_DATA_DIR || join(dirname(fileURLToPath(import.meta.url)), "..", "data");
mkdirSync(join(DATA_DIR, "voices"), { recursive: true });

export const db = new DatabaseSync(join(DATA_DIR, "jarvis.db"));
// WAL + busy_timeout: permite leituras concorrentes (ex.: scripts/CLI) sem "database is locked".
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA busy_timeout = 5000;");
db.exec(`
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, content TEXT NOT NULL, tags TEXT DEFAULT '', embedding TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS agents (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS bots (id TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, bot_id TEXT, started_at TEXT, status TEXT, output TEXT);
CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, command TEXT, status TEXT, output TEXT, created_at TEXT);
CREATE TABLE IF NOT EXISTS approval_actions (approval_id TEXT PRIMARY KEY, action TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, kind TEXT, detail TEXT);
`);

/** True when the structured correlation column exists on `approval_actions` (migration v9).
 *  Explicit PRAGMA check — capability is never inferred by catching generic SQL errors. */
export const detectApprovalCorrelation = (database) =>
  database.prepare("PRAGMA table_info(approval_actions)").all().some((c) => c.name === "correlation_id");

// Versioned migrations: verified backup first, one transaction per step, abort on failure.
export const migration = migrate(db, DATA_DIR);
if (migration.backup) console.log(`[db] schema v${migration.from} → v${migration.to}; backup verificado em ${migration.backup}`);

// Explicit schema capability (v8 has no column; v9 does). Lets the code run against both
// versions without hiding generic SQL errors behind a broad fallback.
export const schema = {
  approvalCorrelation: detectApprovalCorrelation(db),
  executionEvidence: !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='execution_evidence'").get(),
};

export const now = () => new Date().toISOString();
export const uid = () => randomUUID();

export function kvGet(key, fallback = null) {
  const row = db.prepare("SELECT value FROM kv WHERE key = ?").get(key);
  return row ? JSON.parse(row.value) : fallback;
}
export function kvSet(key, value) {
  db.prepare("INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, JSON.stringify(value));
}
// Audit = metadata only. Explicit allowlist of fields; anything else (commands, messages, paths,
// prompts, whole context objects) is dropped, never serialized. Both admins can read the audit.
const CODE = /^[a-zA-Z0-9_.:@-]{1,80}$/;
// Closed sets: free-form values from users/models are never written to the audit.
export const AUDIT_REASONS = new Set([
  "legacy_blocked", "owner_inactive", "no_owner", "host_disabled", "invalid_credentials", "too_many_attempts",
  "setup_closed", "invalid_bootstrap_token", "bootstrap_token_expired", "invalid_username", "weak_password",
  "reauth_failed", "admin_limit_reached", "username_taken", "last_admin_protected", "admin_session_required",
  "invalid_scopes", "wildcard_scope_forbidden", "admin_scope_forbidden", "unknown_scope", "foreign_bot_run",
  "already_resolved", "not_found", "unauthorized", "forbidden", "csrf_rejected", "timeout", "interrupted", "unknown_action", "ambiguous_result", "policy_changed", "correlation_mismatch",
]);
export const AUDIT_AGENTS = new Set(["cli_agent", "claude", "claude_code", "codex", "opencode", "gemini", "hermes", "odysseus", "openhands", "default"]);
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUDIT_FIELDS = {
  // code-like values only (ids, enums, principal tags)
  admin: "code", by: "code", bot: "code", owner: "code", trigger_type: "code", reason: "reason",
  approvalId: "code", status: "code", autonomy: "code", agent: "agent", action: "code", principal: "code",
  tool: "code", scope: "code", need: "code", type: "code", channel: "code", account: "code", username: "code",
  route: "route",
  // structured metadata (no filesystem paths, no tokens, no request URLs)
  scopes: "codes", ids: "codes", count: "num", from: "num", to: "num", backup_verified: "bool", report: "counts", at: "code",
  fromAdmin: "code", toAdmin: "code", correlation: "code",
  // Evidência por execução (P0): apenas metadados técnicos — nunca conteúdo privado, caminhos ou segredos.
  executionId: "code", exitCode: "num", verification: "code", verifiedBy: "code", inputHash: "code",
};
function cleanAuditValue(kind, v) {
  if (kind === "num") return Number.isFinite(v) ? v : undefined;
  if (kind === "route") return typeof v === "string" && /^\/api(\/[a-z0-9_:-]+)*$/.test(v) && v.length <= 80 ? v : undefined;
  if (kind === "bool") return typeof v === "boolean" ? v : undefined;
  if (kind === "reason") return typeof v === "string" && AUDIT_REASONS.has(v) ? v : undefined;
  if (kind === "agent") return typeof v === "string" && (AUDIT_AGENTS.has(v) || UUID_V4.test(v)) ? v : undefined;
  if (kind === "code") return typeof v === "string" && CODE.test(v) ? v : undefined;
  if (kind === "codes") return Array.isArray(v) ? v.filter((x) => typeof x === "string" && CODE.test(x)).slice(0, 500) : undefined;
  if (kind === "counts") {
    if (!v || typeof v !== "object") return undefined;
    const out = {};
    for (const [k, inner] of Object.entries(v)) {
      if (!CODE.test(k) || !inner || typeof inner !== "object") continue;
      out[k] = Object.fromEntries(Object.entries(inner).filter(([ik, n]) => CODE.test(ik) && Number.isFinite(n)));
    }
    return out;
  }
  return undefined;
}
export function sanitizeAudit(detail) {
  const out = {};
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return out;
  let dropped = 0;
  for (const [k, v] of Object.entries(detail)) {
    const val = Object.hasOwn(AUDIT_FIELDS, k) ? cleanAuditValue(AUDIT_FIELDS[k], v) : undefined;
    if (val === undefined) dropped++; else out[k] = val;
  }
  if (dropped) out.dropped = dropped;
  return out;
}
export function audit(kind, detail) {
  const r = db.prepare("INSERT INTO audit (at, kind, detail) VALUES (?, ?, ?)").run(now(), String(kind).slice(0, 80), JSON.stringify(sanitizeAudit(detail)));
  return Number(r.lastInsertRowid); // referência para execution_evidence.audit_id
}

// Correlação de uma aprovação: a coluna estruturada (v9) é autoritativa quando preenchida; o
// campo JSON legado é o fallback. Só valores UUID v4 (o contrato, gerado por código confiável)
// são aceitos. Divergência NUNCA é resolvida em silêncio: registra um diagnóstico sanitizado e
// mantém a coluna como valor seguro (ela só é escrita pelo código do serviço).
const correlationValid = (v) => (typeof v === "string" && UUID_V4.test(v) ? v : null);
/** Pure: resolve column/JSON into a single validated correlation and flag divergence. */
export function resolveCorrelation(columnValue, jsonValue) {
  const col = correlationValid(columnValue);
  const json = correlationValid(jsonValue);
  const mismatch = (columnValue != null && col === null) || (jsonValue != null && json === null) || (col !== null && json !== null && col !== json);
  return { value: col || json || null, mismatch };
}
/** Correlation for an approval id: prefers the v9 column, falls back to the legacy JSON field. */
export function approvalCorrelation(approvalId, action, { database = db, hasColumn = schema.approvalCorrelation } = {}) {
  const columnValue = hasColumn
    ? (database.prepare("SELECT correlation_id FROM approval_actions WHERE approval_id = ?").get(approvalId)?.correlation_id ?? null)
    : null;
  const { value, mismatch } = resolveCorrelation(columnValue, action?.correlation ?? null);
  if (mismatch) audit("audit.correlation_mismatch", { approvalId, reason: "correlation_mismatch" });
  return value;
}
/** Writes an approval_actions row, adding the structured correlation column only when it exists.
 *  The JSON keeps `action.correlation` during the transition (legacy readers stay valid). */
export function insertApprovalAction(approvalId, action, correlation, { database = db, hasColumn = schema.approvalCorrelation } = {}) {
  const json = JSON.stringify(action);
  const corr = correlationValid(correlation);
  if (hasColumn) database.prepare("INSERT INTO approval_actions (approval_id, action, correlation_id, created_at) VALUES (?, ?, ?, ?)").run(approvalId, json, corr, now());
  else database.prepare("INSERT INTO approval_actions (approval_id, action, created_at) VALUES (?, ?, ?)").run(approvalId, json, now());
}

/** Evidência por execução (P0). Apenas metadados técnicos — nunca conteúdo, caminhos ou segredos.
 *  `state` é o estado técnico do processo; `verification` é a pós-condição do OBJETIVO (código de
 *  saída 0 NÃO prova, por si, que o objetivo foi alcançado). Sem a tabela (esquema antigo) a
 *  gravação é ignorada: a evidência nunca derruba a execução. */
export const EVIDENCE_STATES = new Set(["completed", "failed", "timeout", "error", "overflow", "denied", "cancelled", "unknown"]);
export const EVIDENCE_VERIFICATIONS = new Set(["verified", "unverified", "unknown"]);
export function recordEvidence({ id = uid(), approvalId = null, kind, state, exitCode = null, verification = "unknown", verifiedBy = "none", inputHash = null, correlation = null, auditId = null, database = db, hasTable = schema.executionEvidence } = {}) {
  if (!hasTable) return null;
  database.prepare("INSERT INTO execution_evidence (id, approval_id, kind, state, exit_code, verification, verified_by, input_hash, correlation, audit_id, at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, approvalId, String(kind).slice(0, 40), String(state).slice(0, 20), Number.isInteger(exitCode) ? exitCode : null,
      String(verification).slice(0, 20), String(verifiedBy).slice(0, 20), inputHash, correlation, auditId, now());
  return id;
}
/** Evidências de uma aprovação (para API/painel). Só metadados; nunca conteúdo privado. */
export const listEvidence = (approvalId) =>
  db.prepare("SELECT id, approval_id AS approvalId, kind, state, exit_code AS exitCode, verification, verified_by AS verifiedBy, input_hash AS inputHash, correlation, audit_id AS auditId, at FROM execution_evidence WHERE approval_id = ? ORDER BY at DESC, rowid DESC").all(approvalId);

// An approval left in "running" means the process stopped mid-execution. It is never re-run
// (at-most-once); it is marked "interrupted" so it cannot look pending. The external effect
// may or may not have happened: the audit records outcome "unknown" — never a retroactive
// success — and nothing is re-executed; the owner must verify at the destination.
const interruptedRows = db.prepare("SELECT id FROM approvals WHERE status = 'running'").all();
if (interruptedRows.length) {
  const interruption = db.prepare("SELECT action FROM approval_actions WHERE approval_id = ?");
  const readAction = (id) => {
    try { return JSON.parse(interruption.get(id)?.action ?? "") ?? {}; } catch { return {}; }
  };
  db.prepare("UPDATE approvals SET status = 'interrupted' WHERE status = 'running'").run();
  for (const { id } of interruptedRows) {
    const a = readAction(id);
    const kind = typeof a.kind === "string" ? a.kind : "run_command";
    const correlation = approvalCorrelation(id, a);
    audit(`${kind}(unknown)`, { approvalId: id, kind, status: "unknown", reason: "interrupted", ...(correlation ? { correlation } : {}) });
  }
}

// JSON document tables (agents, bots)
export function docs(table) {
  return {
    list: () => db.prepare(`SELECT data FROM ${table}`).all().map((r) => JSON.parse(r.data)),
    get: (id) => { const r = db.prepare(`SELECT data FROM ${table} WHERE id = ?`).get(id); return r ? JSON.parse(r.data) : null; },
    save: (item) => {
      const full = { ...(item.id ? docs(table).get(item.id) || {} : {}), ...item, id: item.id || uid() };
      db.prepare(`INSERT INTO ${table} (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`).run(full.id, JSON.stringify(full));
      return full;
    },
    remove: (id) => db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id),
  };
}
export const agents = docs("agents");
export const bots = docs("bots");

// Phase 2: no agent is seeded anymore (it would be an unowned record). Admins without an agent
// use the built-in template DEFAULT_AGENT (server/llm.js), which is not stored.

export const auth = createAuth(db, { dataDir: DATA_DIR, audit });

// Migration report (D3 item 8): counts only, never content. Written after the migration commit.
if (migration.backup && migration.to >= 2 && migration.from < 2) {
  const report = {};
  for (const [type, table] of [["memory", "memories"], ["agent", "agents"], ["bot", "bots"], ["run", "runs"], ["approval", "approvals"]]) {
    const total = db.prepare(`SELECT COUNT(*) n FROM ${table}`).get().n;
    const owned = db.prepare(`SELECT COUNT(*) n FROM ${table} t JOIN ownership o ON o.resource_type = ? AND o.resource_id = t.id`).get(type).n;
    report[type] = { total, owned, unowned: total - owned };
  }
  audit("migration.v2_report", { from: migration.from, to: migration.to, backup_verified: true, report });
  console.log(`[db] propriedade após v2: ${JSON.stringify(report)}`);
}

// Versioned, idempotent schema migrations with a verified backup before any change.
// Schema version lives in PRAGMA user_version. Each migration runs inside one transaction:
// if anything fails (including the row-count and row-content check), it rolls back and the database stays
// exactly as it was — never partially migrated. See docs/RECUPERACAO.md.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

/** Tables whose rows must survive every migration untouched. */
export const PRESERVED = ["kv", "memories", "agents", "bots", "runs", "approvals", "audit"];

export const MIGRATIONS = [
  {
    version: 1,
    name: "auth: admins, sessions, login throttling, service tokens",
    sql: `
CREATE TABLE IF NOT EXISTS admins (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  created_by TEXT
);
CREATE TRIGGER IF NOT EXISTS trg_admins_max_two BEFORE INSERT ON admins
WHEN NEW.active = 1 AND (SELECT COUNT(*) FROM admins WHERE active = 1) >= 2
BEGIN SELECT RAISE(ABORT, 'admin_limit_reached'); END;
CREATE TRIGGER IF NOT EXISTS trg_admins_max_two_reactivate BEFORE UPDATE OF active ON admins
WHEN OLD.active = 0 AND NEW.active = 1 AND (SELECT COUNT(*) FROM admins WHERE active = 1) >= 2
BEGIN SELECT RAISE(ABORT, 'admin_limit_reached'); END;
CREATE TRIGGER IF NOT EXISTS trg_admins_protect_last_delete BEFORE DELETE ON admins
WHEN OLD.active = 1 AND (SELECT COUNT(*) FROM admins WHERE active = 1) <= 1
BEGIN SELECT RAISE(ABORT, 'last_admin_protected'); END;
CREATE TRIGGER IF NOT EXISTS trg_admins_protect_last_disable BEFORE UPDATE OF active ON admins
WHEN OLD.active = 1 AND NEW.active = 0 AND (SELECT COUNT(*) FROM admins WHERE active = 1) <= 1
BEGIN SELECT RAISE(ABORT, 'last_admin_protected'); END;

CREATE TABLE IF NOT EXISTS sessions (
  id_hash TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id),
  csrf TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_admin ON sessions(admin_id);

CREATE TABLE IF NOT EXISTS login_attempts (
  key TEXT PRIMARY KEY,
  failures INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS service_tokens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  scopes TEXT NOT NULL,
  admin_id TEXT NOT NULL REFERENCES admins(id),
  created_at INTEGER NOT NULL,
  last_used INTEGER,
  revoked_at INTEGER
);

CREATE TABLE IF NOT EXISTS bootstrap (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
`,
  },
  {
    version: 2,
    name: "isolation: resource ownership, personal/global settings, legacy claims",
    // Only NEW tables are created; preserved tables are read, never written, so the
    // count + SHA-256 check proves memories/agents/bots/runs/approvals/kv/audit are untouched.
    // Ownership is copied only from a provable source:
    //  - bots: owner_admin_id already stored in the bot JSON (Phase 1) AND that admin exists;
    //  - runs: the run's bot has such a proven owner (owners never change after creation);
    //  - everything else (memories, agents, approvals, unproven bots/runs) stays without owner.
    sql: (db) => V2_SCHEMA + V2_COPY.filter((c) => c.needs.every((t) => tableExists(db, t))).map((c) => c.sql).join("\n"),
  },
  {
    version: 3,
    name: "documents: private local document store (TXT first)",
    // Adds `documents` and extends the `ownership` CHECK to the new resource type 'document'.
    // Only the ownership table is rebuilt (it is NOT in PRESERVED); preserved tables are
    // read-only here, so the framework's count + SHA-256 check still proves they are untouched.
    sql: `
CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mime TEXT NOT NULL,
  size INTEGER NOT NULL,
  path TEXT NOT NULL,
  content_text TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_documents_created ON documents(created_at);

DROP TRIGGER IF EXISTS trg_ownership_immutable;
DROP INDEX IF EXISTS idx_ownership_owner;
ALTER TABLE ownership RENAME TO ownership_v2;
CREATE TABLE ownership (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('memory','agent','bot','run','approval','document')),
  resource_id TEXT NOT NULL,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  assigned_at TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('created','migrated','claimed')),
  PRIMARY KEY (resource_type, resource_id)
);
INSERT INTO ownership SELECT resource_type, resource_id, owner_admin_id, assigned_at, origin FROM ownership_v2;
DROP TABLE ownership_v2;
CREATE INDEX idx_ownership_owner ON ownership(owner_admin_id, resource_type);
CREATE TRIGGER trg_ownership_immutable BEFORE UPDATE ON ownership
BEGIN SELECT RAISE(ABORT, 'ownership_immutable'); END;
`,
  },
  {
    version: 4,
    name: "d-rec: session reauth, transferable ownership, ownership history",
    // Adds `reauth_at` to sessions (nullable), extends the ownership CHECK with 'transferred'
    // (ownership is NOT in PRESERVED — the framework still proves preserved tables unchanged),
    // and adds an append-only `ownership_history` for transfers. No transfer runs here.
    sql: (db) => {
      const hasCol = db.prepare("PRAGMA table_info(sessions)").all().some((c) => c.name === "reauth_at");
      return `
${hasCol ? "" : "ALTER TABLE sessions ADD COLUMN reauth_at INTEGER;"}
DROP TRIGGER IF EXISTS trg_ownership_immutable;
DROP INDEX IF EXISTS idx_ownership_owner;
ALTER TABLE ownership RENAME TO ownership_v3;
CREATE TABLE ownership (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('memory','agent','bot','run','approval','document')),
  resource_id TEXT NOT NULL,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  assigned_at TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('created','migrated','claimed','transferred')),
  PRIMARY KEY (resource_type, resource_id)
);
INSERT INTO ownership SELECT resource_type, resource_id, owner_admin_id, assigned_at, origin FROM ownership_v3;
DROP TABLE ownership_v3;
CREATE INDEX idx_ownership_owner ON ownership(owner_admin_id, resource_type);
CREATE TRIGGER trg_ownership_immutable BEFORE UPDATE ON ownership
BEGIN SELECT RAISE(ABORT, 'ownership_immutable'); END;

CREATE TABLE IF NOT EXISTS ownership_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  from_admin_id TEXT,
  to_admin_id TEXT NOT NULL,
  actor_admin_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('transfer')),
  correlation_id TEXT NOT NULL,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ownership_history_resource ON ownership_history(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_ownership_history_corr ON ownership_history(correlation_id);
`;
    },
  },
  {
    version: 5,
    name: "d-rec: manual purge jobs (staged, resumable, idempotent)",
    // Manual-only purge. No retention deadlines. A job quarantines eligible resources first,
    // then removes them item by item (idempotent). Preserved tables are untouched.
    sql: `
CREATE TABLE IF NOT EXISTS purge_jobs (
  id TEXT PRIMARY KEY,
  actor_admin_id TEXT NOT NULL REFERENCES admins(id),
  from_admin_id TEXT NOT NULL REFERENCES admins(id),
  resource_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('isolated','done','error')),
  correlation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS purge_items (
  job_id TEXT NOT NULL REFERENCES purge_jobs(id),
  resource_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('isolated','removed')),
  error TEXT,
  PRIMARY KEY (job_id, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_purge_items_job ON purge_items(job_id);
CREATE TABLE IF NOT EXISTS purge_quarantine (
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  job_id TEXT NOT NULL REFERENCES purge_jobs(id),
  at TEXT NOT NULL,
  PRIMARY KEY (resource_type, resource_id)
);
`,
  },
  {
    version: 6,
    name: "approval_actions: structured action bound to the concrete operation",
    // `approvals.command` stays the human-readable description shown in the panel. The exact
    // operation (kind + payload + destination fingerprint) lives in a side table so an approval
    // authorizes only that operation and can never be replayed for a different one.
    // Tabela lateral (e não uma coluna em `approvals`): `approvals` está em PRESERVED e a
    // checagem de migração compara o conteúdo das linhas — adicionar coluna a alteraria.
    sql: `
CREATE TABLE IF NOT EXISTS approval_actions (
  approval_id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`,
  },
  {
    version: 7,
    name: "conversations: persistent, owner-scoped chat history (cascade delete)",
    // Fase H: histórico persistente de conversas. O proprietário é a própria coluna `admin_id`
    // (não a tabela `ownership`): a conversa nasce e morre com o seu dono — nunca é reivindicada
    // nem transferida, e toda consulta filtra pelo dono. `reply_to` liga a resposta à mensagem
    // do usuário (no máximo uma resposta por mensagem — índice único parcial) e `client_msg_id`
    // (único por conversa) torna o envio idempotente: reenvio/retry não duplica mensagens.
    // Exclusão: mensagens filhas são removidas na mesma transação da conversa.
    sql: `
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id),
  title TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_conversations_admin ON conversations(admin_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  meta TEXT,
  client_msg_id TEXT,
  reply_to TEXT REFERENCES conversation_messages(id),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_convmsg_conv ON conversation_messages(conversation_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_convmsg_client ON conversation_messages(conversation_id, client_msg_id) WHERE client_msg_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_convmsg_reply ON conversation_messages(reply_to) WHERE reply_to IS NOT NULL;
`,
  },
  {
    version: 8,
    name: "conversations.agent_id: per-conversation agent/model choice (additive ALTER)",
    // A v7 já havia sido aplicada em instalações existentes quando esta coluna foi introduzida —
    // por isso a v7 permanece exatamente como aplicada e a v8 apenas ACRESCENTA a coluna (ALTER
    // aditivo, sem tocar em nenhuma linha). `agent_id` fixa o agente escolhido PARA AQUELA conversa
    // na criação (NULL = padrão do dono); nunca altera configurações globais nem outras conversas.
    // Sem chave estrangeira de propósito: se o agente for excluído, a conversa simplesmente volta
    // ao padrão do administrador (a posse do agente é validada na leitura/uso).
    sql: `ALTER TABLE conversations ADD COLUMN agent_id TEXT;`,
  },
  {
    version: 9,
    name: "approval_actions: structured correlation id (additive ALTER + audit triggers)",
    // Adiciona a coluna `correlation_id` a `approval_actions`, faz backfill a partir do JSON
    // `action.correlation` (registros sem correlação ficam NULL), cria índice e triggers de
    // integridade append-only na tabela `audit`. `approval_actions` NÃO está em PRESERVED, então
    // a checagem de snapshot não afeta a migração. A coluna é aditiva e idempotente.
    // Os triggers só são criados quando `audit` já existe (criada pelo esquema base do serviço
    // antes das migrações). Num banco sem `audit` (ex.: testes que migram do zero) não há trilha
    // a proteger — e criá-la aqui mudaria o snapshot de tabelas preservadas.
    sql: (db) => {
      const hasAudit = !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='audit'").get();
      return `
ALTER TABLE approval_actions ADD COLUMN correlation_id TEXT;
UPDATE approval_actions SET correlation_id = json_extract(action, '$.correlation') WHERE json_extract(action, '$.correlation') IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_approval_actions_correlation ON approval_actions(correlation_id);
${hasAudit ? `CREATE TRIGGER IF NOT EXISTS trg_audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'audit_immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'audit_immutable'); END;` : ""}
`;
    },
  },
  {
    version: 10,
    name: "execution_evidence: ledger de evidências por execução (P0)",
    // Tabela NOVA (não está em PRESERVED). Ledger de evidência por execução, ligado à trilha de
    // auditoria por `audit_id`. Guarda apenas metadados técnicos — estado do processo, código de
    // saída, verificação da pós-condição, hash da entrada canônica e correlação — nunca conteúdo
    // privado, caminhos sensíveis ou segredos. `state`/`verification` são conjuntos fechados
    // validados no código (EVIDENCE_STATES/EVIDENCE_VERIFICATIONS em db.js).
    sql: `
CREATE TABLE IF NOT EXISTS execution_evidence (
  id TEXT PRIMARY KEY,
  approval_id TEXT,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  exit_code INTEGER,
  verification TEXT NOT NULL,
  verified_by TEXT NOT NULL,
  input_hash TEXT,
  correlation TEXT,
  audit_id INTEGER,
  at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_execution_evidence_approval ON execution_evidence(approval_id);
CREATE INDEX IF NOT EXISTS idx_execution_evidence_correlation ON execution_evidence(correlation);
`,
  },
];

const tableExists = (db, t) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);

const V2_SCHEMA = `
CREATE TABLE IF NOT EXISTS ownership (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('memory','agent','bot','run','approval')),
  resource_id TEXT NOT NULL,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  assigned_at TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('created','migrated','claimed')),
  PRIMARY KEY (resource_type, resource_id)
);
CREATE INDEX IF NOT EXISTS idx_ownership_owner ON ownership(owner_admin_id, resource_type);
CREATE TRIGGER IF NOT EXISTS trg_ownership_immutable BEFORE UPDATE ON ownership
BEGIN SELECT RAISE(ABORT, 'ownership_immutable'); END;

CREATE TABLE IF NOT EXISTS admin_settings (
  admin_id TEXT PRIMARY KEY REFERENCES admins(id),
  data TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS global_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS legacy_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  data TEXT NOT NULL,
  claimed_by TEXT REFERENCES admins(id),
  claimed_at TEXT
);
CREATE TABLE IF NOT EXISTS legacy_claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  admin_id TEXT NOT NULL REFERENCES admins(id),
  at TEXT NOT NULL
);
`;
// Data copies run only when the source tables exist (fresh/partial databases skip them).
const V2_COPY = [
  { needs: ["kv"], sql: `
INSERT OR IGNORE INTO legacy_settings (id, data)
  SELECT 1, value FROM kv WHERE key = 'settings';
INSERT OR IGNORE INTO global_settings (id, data)
  SELECT 1, json_object(
    'host', json_extract(value, '$.host'),
    'integrations', json_extract(value, '$.integrations'),
    'localVoiceUrl', json_extract(value, '$.voice.localVoiceUrl'))
  FROM kv WHERE key = 'settings';` },
  { needs: ["bots"], sql: `
INSERT OR IGNORE INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin)
  SELECT 'bot', b.id, json_extract(b.data, '$.owner_admin_id'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'migrated'
  FROM bots b JOIN admins a ON a.id = json_extract(b.data, '$.owner_admin_id');` },
  { needs: ["bots", "runs"], sql: `
INSERT OR IGNORE INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin)
  SELECT 'run', r.id, o.owner_admin_id, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'migrated'
  FROM runs r JOIN ownership o ON o.resource_type = 'bot' AND o.resource_id = r.bot_id;` },
];

const count = (db, t) => {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
  return exists ? db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n : null;
};
export const snapshotCounts = (db) => Object.fromEntries(PRESERVED.map((t) => [t, count(db, t)]));
/** Content fingerprint: SHA-256 over every row (all columns, rowid order) of each preserved table. */
export function snapshotContent(db) {
  const out = {};
  for (const t of PRESERVED) {
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);
    if (!exists) { out[t] = null; continue; }
    const h = createHash("sha256");
    for (const row of db.prepare(`SELECT rowid AS __rowid, * FROM ${t} ORDER BY rowid`).iterate()) h.update(JSON.stringify(row) + "\n");
    out[t] = h.digest("hex");
  }
  return out;
}
const snapshot = (db) => JSON.stringify({ counts: snapshotCounts(db), content: snapshotContent(db) });
export const currentVersion = (db) => db.prepare("PRAGMA user_version").get().user_version;
export const targetVersion = () => MIGRATIONS.at(-1).version;

/** Copy the live database with VACUUM INTO and prove the copy is readable and complete. */
export function backupAndVerify(db, dataDir, label) {
  const dir = join(dataDir, "backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = join(dir, `jarvis-${stamp}-${label}.db`);
  if (existsSync(file)) throw new Error(`backup já existe: ${file}`);
  db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
  const copy = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = copy.prepare("PRAGMA integrity_check").get().integrity_check;
    if (integrity !== "ok") throw new Error(`backup corrompido: ${integrity}`);
    const a = snapshot(db);
    const b = snapshot(copy);
    if (a !== b) throw new Error(`backup incompleto: ${a} != ${b}`);
  } finally {
    copy.close();
  }
  return file;
}

/**
 * Apply pending migrations. Returns { from, to, backup }. Throws (and leaves the database
 * untouched) if the backup cannot be verified or any migration step fails.
 * opts.failAfterSql is a test hook that simulates a crash mid-migration.
 */
export function migrate(db, dataDir, opts = {}) {
  const from = currentVersion(db);
  const list = opts.migrations || MIGRATIONS; // test hook
  const pending = list.filter((m) => m.version > from);
  if (!pending.length) return { from, to: from, backup: null };

  const backup = backupAndVerify(db, dataDir, `v${from}`);
  for (const m of pending) {
    const before = snapshot(db);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(typeof m.sql === "function" ? m.sql(db) : m.sql);
      if (opts.failAfterSql === m.version) throw new Error("falha simulada");
      const after = snapshot(db);
      if (before !== after) throw new Error(`migração ${m.version} alterou dados preservados`);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(`Migração ${m.version} (${m.name}) falhou e foi desfeita: ${e.message}. Backup verificado: ${backup}`);
    }
  }
  return { from, to: currentVersion(db), backup };
}

// Versioned, idempotent schema migrations with a verified backup before any change.
// Schema version lives in PRAGMA user_version. Each migration runs inside one transaction:
// if anything fails (including the row-count and row-content check), it rolls back and the database stays
// exactly as it was — never partially migrated. See docs/RECUPERACAO.md.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { encrypt } from "./secret-crypto.js";

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
    sql: (db) =>
      V2_SCHEMA +
      V2_COPY.filter((c) => c.needs.every((t) => tableExists(db, t)))
        .map((c) => c.sql)
        .join("\n"),
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
      const hasCol = db
        .prepare("PRAGMA table_info(sessions)")
        .all()
        .some((c) => c.name === "reauth_at");
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
      const hasAudit = !!db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='audit'")
        .get();
      return `
ALTER TABLE approval_actions ADD COLUMN correlation_id TEXT;
UPDATE approval_actions SET correlation_id = json_extract(action, '$.correlation') WHERE json_extract(action, '$.correlation') IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_approval_actions_correlation ON approval_actions(correlation_id);
${
  hasAudit
    ? `CREATE TRIGGER IF NOT EXISTS trg_audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'audit_immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT, 'audit_immutable'); END;`
    : ""
}
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
  {
    version: 11,
    name: "session_focus: objetivo/resumo/decisões da sessão por administrador (P0.2)",
    // Tabela NOVA (não está em PRESERVED). Foco da sessão EDITÁVEL pelo próprio administrador,
    // sempre por DONO (`admin_id` = PK): nunca global e nunca atribuído a um registro legado.
    // Guarda apenas texto de trabalho do painel (objetivo, resumo, decisões em JSON) — nenhum
    // segredo, credencial, caminho ou cookie. O "próximo passo"/pendência NÃO é persistido aqui:
    // continua derivado de aprovações e execuções reais, para o painel nunca inventar estado.
    sql: `
CREATE TABLE IF NOT EXISTS session_focus (
  admin_id TEXT PRIMARY KEY REFERENCES admins(id),
  objective TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  decisions TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT
);
`,
    // Asserção de esquema (P0.3.1): valida tipo, colunas e PK DEPOIS do SQL e ANTES do COMMIT.
    expect: [
      {
        table: "session_focus",
        type: "table",
        columns: ["admin_id", "objective", "summary", "decisions", "updated_at"],
        primaryKey: ["admin_id"],
      },
    ],
  },
  {
    version: 12,
    name: "document_chunks: semantic RAG chunks and embeddings per owner (Roadmap v1.1)",
    // Roadmap v1.1 — Fase 1: RAG Semântico Híbrido com chunks indexados por documento e por admin.
    // Adiciona colunas aditivas em `documents` e cria a tabela `document_chunks` vinculada com
    // ON DELETE CASCADE ao documento pai. Isolamento multi-tenant garantido pela coluna `admin_id`.
    sql: (db) => {
      const hasDocs = !!db
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='documents'")
        .get();
      const docCols = hasDocs
        ? db
            .prepare("PRAGMA table_info(documents)")
            .all()
            .map((c) => c.name)
        : [];
      const addChunkCount =
        hasDocs && !docCols.includes("chunk_count")
          ? "ALTER TABLE documents ADD COLUMN chunk_count INTEGER DEFAULT 0;"
          : "";
      const addRagStatus =
        hasDocs && !docCols.includes("rag_status")
          ? "ALTER TABLE documents ADD COLUMN rag_status TEXT DEFAULT 'lexical';"
          : "";
      return `
${addChunkCount}
${addRagStatus}
CREATE TABLE IF NOT EXISTS document_chunks (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  admin_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  embedding_json TEXT,
  embedding_model TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_doc_id ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_admin_id ON document_chunks(admin_id);
`;
    },
    expect: [
      {
        table: "document_chunks",
        type: "table",
        columns: [
          "id",
          "document_id",
          "admin_id",
          "chunk_index",
          "content",
          "token_estimate",
          "embedding_json",
          "embedding_model",
          "created_at",
        ],
        primaryKey: ["id"],
      },
    ],
  },
  {
    version: 13,
    name: "agentmail_events: metadados de webhook AgentMail (message.received, Svix)",
    // Integração AgentMail (v0 API): eventos recebidos por webhook assinado (Svix), dedupe pela
    // PK svix_id — o provider repete o MESMO id em retries, e a entrega é rejeitada como
    // duplicata sem reprocesso. Guarda SOMENTE metadados do envelope (ids, de, assunto):
    // nunca o corpo do e-mail (conteúdo lido sob demanda via API, com escopo comms:read).
    // Tabela NOVA, não pertence a PRESERVED e nunca é atribuída a registro legado.
    // Níveis globais da organização (inbox id da org), unicidade global; leitura filtrada
    // por rota com escopo próprio (nunca por owner de registro legado).
    sql: `
CREATE TABLE IF NOT EXISTS agentmail_events (
  svix_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  event_id TEXT,
  inbox_id TEXT,
  thread_id TEXT,
  message_id TEXT,
  from_addr TEXT,
  subject TEXT,
  to_addr TEXT,
  received_at TEXT,
  processed_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_agentmail_events_processed ON agentmail_events(processed_at);
`,
    expect: [
      {
        table: "agentmail_events",
        type: "table",
        columns: [
          "svix_id",
          "event_type",
          "event_id",
          "inbox_id",
          "thread_id",
          "message_id",
          "from_addr",
          "subject",
          "to_addr",
          "received_at",
          "processed_at",
        ],
        primaryKey: ["svix_id"],
      },
    ],
  },
  {
    version: 14,
    name: "AgentMail inbox ownership registry",
    // AgentMail inboxes are shared provider resources, but Jarvis content access remains
    // per-admin. Existing events/inboxes are not assigned here; an admin must explicitly claim
    // the configured inbox. The registry is new and ownership is recorded in the canonical table.
    sql: `
CREATE TABLE IF NOT EXISTS agentmail_inboxes (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL
);
DROP TRIGGER IF EXISTS trg_ownership_immutable;
DROP INDEX IF EXISTS idx_ownership_owner;
ALTER TABLE ownership RENAME TO ownership_v13;
CREATE TABLE ownership (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('memory','agent','bot','run','approval','document','agentmail_inbox')),
  resource_id TEXT NOT NULL,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  assigned_at TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('created','migrated','claimed','transferred')),
  PRIMARY KEY (resource_type, resource_id)
);
INSERT INTO ownership SELECT resource_type, resource_id, owner_admin_id, assigned_at, origin FROM ownership_v13;
DROP TABLE ownership_v13;
CREATE INDEX idx_ownership_owner ON ownership(owner_admin_id, resource_type);
CREATE TRIGGER trg_ownership_immutable BEFORE UPDATE ON ownership
BEGIN SELECT RAISE(ABORT, 'ownership_immutable'); END;
`,
    expect: [
      {
        table: "agentmail_inboxes",
        type: "table",
        columns: ["id", "created_at"],
        primaryKey: ["id"],
      },
      {
        table: "ownership",
        type: "table",
        columns: ["resource_type", "resource_id", "owner_admin_id", "assigned_at", "origin"],
        primaryKey: ["resource_type", "resource_id"],
      },
    ],
  },
  {
    version: 15,
    name: "scheduler: idempotency ledger for scheduled bot triggers",
    // Aditiva: registra apenas chaves de disparo e estado técnico, nunca tarefa, prompt ou resultado.
    // A PK impede replay de um mesmo disparo diário/intervalo/arquivo após restart. Claims em voo
    // não são repetidos automaticamente: a ocorrência fica `interrupted` para evitar efeitos duplos.
    sql: `
CREATE TABLE IF NOT EXISTS bot_schedule_claims (
  trigger_key TEXT PRIMARY KEY,
  bot_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('daily','interval','file')),
  status TEXT NOT NULL CHECK (status IN ('claimed','running','done','awaiting_approval','error','skipped','denied','cancelled','interrupted')),
  run_id TEXT,
  claimed_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_bot_schedule_claims_bot_time ON bot_schedule_claims(bot_id, claimed_at);
`,
    expect: [
      {
        table: "bot_schedule_claims",
        type: "table",
        columns: [
          "trigger_key",
          "bot_id",
          "trigger_type",
          "status",
          "run_id",
          "claimed_at",
          "updated_at",
        ],
        primaryKey: ["trigger_key"],
      },
    ],
  },
  {
    version: 16,
    name: "durable scheduler jobs with explicit ownership and leases",
    // Additive job queue. Existing claim ledger remains the trigger de-duplication source;
    // ownership is extended so queue rows obey the single ownership-table invariant.
    sql: `
CREATE TABLE IF NOT EXISTS durable_jobs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  bot_id TEXT NOT NULL,
  trigger_type TEXT NOT NULL CHECK (trigger_type IN ('daily','interval','file')),
  occurrence_key TEXT NOT NULL,
  encrypted_payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','succeeded','awaiting_approval','failed','cancelled','needs_reconciliation')),
  attempts INTEGER NOT NULL DEFAULT 0,
  available_at TEXT NOT NULL,
  lease_owner TEXT,
  lease_until TEXT,
  run_id TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_durable_jobs_claim ON durable_jobs(status, available_at, created_at);
CREATE INDEX IF NOT EXISTS idx_durable_jobs_bot ON durable_jobs(bot_id, created_at);

DROP TRIGGER IF EXISTS trg_ownership_immutable;
DROP INDEX IF EXISTS idx_ownership_owner;
ALTER TABLE ownership RENAME TO ownership_v15;
CREATE TABLE ownership (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('memory','agent','bot','run','approval','document','agentmail_inbox','job')),
  resource_id TEXT NOT NULL,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  assigned_at TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('created','migrated','claimed','transferred')),
  PRIMARY KEY (resource_type, resource_id)
);
INSERT INTO ownership SELECT resource_type, resource_id, owner_admin_id, assigned_at, origin FROM ownership_v15;
DROP TABLE ownership_v15;
CREATE INDEX idx_ownership_owner ON ownership(owner_admin_id, resource_type);
CREATE TRIGGER trg_ownership_immutable BEFORE UPDATE ON ownership
BEGIN SELECT RAISE(ABORT, 'ownership_immutable'); END;
`,
    expect: [
      {
        table: "durable_jobs",
        type: "table",
        columns: [
          "id",
          "idempotency_key",
          "bot_id",
          "trigger_type",
          "occurrence_key",
          "encrypted_payload",
          "status",
          "attempts",
          "available_at",
          "lease_owner",
          "lease_until",
          "run_id",
          "last_error",
          "created_at",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "ownership",
        type: "table",
        columns: ["resource_type", "resource_id", "owner_admin_id", "assigned_at", "origin"],
        primaryKey: ["resource_type", "resource_id"],
      },
    ],
  },
  {
    version: 17,
    name: "memory retention: per-admin opt-in and recoverable quarantine",
    sql: `
CREATE TABLE IF NOT EXISTS memory_retention_policies (
  admin_id TEXT PRIMARY KEY REFERENCES admins(id),
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  retention_days INTEGER NOT NULL CHECK (retention_days IN (30,90,180,365)),
  grace_days INTEGER NOT NULL DEFAULT 30 CHECK (grace_days BETWEEN 7 AND 90),
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_retention_anchors (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  anchor_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS memory_retention_items (
  memory_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  quarantined_at TEXT NOT NULL,
  purge_after TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memory_retention_purge ON memory_retention_items(purge_after);
`,
    expect: [
      {
        table: "memory_retention_policies",
        type: "table",
        columns: ["admin_id", "enabled", "retention_days", "grace_days", "updated_at"],
        primaryKey: ["admin_id"],
      },
      {
        table: "memory_retention_anchors",
        type: "table",
        columns: ["memory_id", "anchor_at"],
        primaryKey: ["memory_id"],
      },
      {
        table: "memory_retention_items",
        type: "table",
        columns: ["memory_id", "owner_admin_id", "quarantined_at", "purge_after"],
        primaryKey: ["memory_id"],
      },
    ],
  },
  {
    version: 18,
    name: "provider OAuth connections with owner-scoped token storage",
    sql: `
CREATE TABLE IF NOT EXISTS oauth_states (
  state_hash TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admins(id),
  provider TEXT NOT NULL CHECK (provider IN ('google','microsoft')),
  encrypted_verifier TEXT NOT NULL,
  include_send INTEGER NOT NULL DEFAULT 0 CHECK (include_send IN (0,1)),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_oauth_states_expiry ON oauth_states(expires_at);
CREATE TABLE IF NOT EXISTS oauth_connections (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('google','microsoft')),
  provider_user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  scopes TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('connected','reconnect')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

DROP TRIGGER IF EXISTS trg_ownership_immutable;
DROP INDEX IF EXISTS idx_ownership_owner;
ALTER TABLE ownership RENAME TO ownership_v17;
CREATE TABLE ownership (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('memory','agent','bot','run','approval','document','agentmail_inbox','job','integration_connection')),
  resource_id TEXT NOT NULL,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  assigned_at TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('created','migrated','claimed','transferred')),
  PRIMARY KEY (resource_type, resource_id)
);
INSERT INTO ownership SELECT resource_type, resource_id, owner_admin_id, assigned_at, origin FROM ownership_v17;
DROP TABLE ownership_v17;
CREATE INDEX idx_ownership_owner ON ownership(owner_admin_id, resource_type);
CREATE TRIGGER trg_ownership_immutable BEFORE UPDATE ON ownership
BEGIN SELECT RAISE(ABORT, 'ownership_immutable'); END;
`,
    expect: [
      {
        table: "oauth_states",
        type: "table",
        columns: [
          "state_hash",
          "admin_id",
          "provider",
          "encrypted_verifier",
          "include_send",
          "expires_at",
          "created_at",
        ],
        primaryKey: ["state_hash"],
      },
      {
        table: "oauth_connections",
        type: "table",
        columns: [
          "id",
          "provider",
          "provider_user_id",
          "email",
          "encrypted_refresh_token",
          "scopes",
          "status",
          "created_at",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "ownership",
        type: "table",
        columns: ["resource_type", "resource_id", "owner_admin_id", "assigned_at", "origin"],
        primaryKey: ["resource_type", "resource_id"],
      },
    ],
  },
  {
    version: 19,
    name: "approval_actions: encrypt browser form payloads",
    // Existing pending approvals remain usable, but their free-form browser input is encrypted
    // before the application starts serving requests. The migration is transactional and has a
    // verified pre-migration backup; malformed actions or a missing key fail closed.
    apply(database, { encryptFn }) {
      const rows = database.prepare("SELECT approval_id,action FROM approval_actions").all();
      const update = database.prepare("UPDATE approval_actions SET action=? WHERE approval_id=?");
      for (const row of rows) {
        let action;
        try {
          action = JSON.parse(row.action);
        } catch {
          throw new Error("invalid_approval_action_json");
        }
        if (action?.kind !== "browser_action" || action?.params?.op !== "fill") continue;
        if (action.params.text === undefined) continue;
        if (typeof action.params.text !== "string") throw new Error("invalid_browser_fill_payload");
        const plaintext = action.params.text;
        const encryptedText = encryptFn(plaintext);
        if (typeof encryptedText !== "string" || encryptedText === plaintext)
          throw new Error("browser_payload_encryption_failed");
        const { text: _plaintext, ...params } = action.params;
        action.params = { ...params, encryptedText };
        update.run(JSON.stringify(action), row.approval_id);
      }
    },
  },
  {
    // Fase 1 da evolução (docs/evolution/phase-1): Workforce de agentes. Tabelas novas — a
    // legada `agents` (store JSON, PRESERVED) permanece intocada. O ownership é recriado para
    // estender o CHECK com os tipos novos; linhas existentes são preservadas integralmente.
    version: 20,
    name: "workforce: persistent agent definitions and runs with hierarchical budgets",
    sql: `
CREATE TABLE IF NOT EXISTS agent_definitions (
  id TEXT PRIMARY KEY,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'specialist' CHECK (role IN ('orchestrator','specialist','worker')),
  description TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  instructions TEXT NOT NULL DEFAULT '',
  instruction_ref TEXT,
  instruction_checksum TEXT,
  model_preferences TEXT NOT NULL DEFAULT '{}',
  permitted_tools TEXT NOT NULL DEFAULT '[]',
  permission_scopes TEXT NOT NULL DEFAULT '[]',
  resource_budget TEXT NOT NULL DEFAULT '{}',
  execution_limits TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0,1)),
  metadata TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_admin_id, name)
);
CREATE INDEX IF NOT EXISTS idx_agent_definitions_owner ON agent_definitions(owner_admin_id);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES agent_definitions(id) ON DELETE CASCADE,
  definition_version INTEGER NOT NULL,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  parent_run_id TEXT REFERENCES agent_runs(id) ON DELETE SET NULL,
  correlation_id TEXT NOT NULL,
  idempotency_key TEXT,
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','awaiting_approval','completed','failed','cancelled','unknown')),
  depth INTEGER NOT NULL DEFAULT 0 CHECK (depth >= 0),
  budget_json TEXT NOT NULL DEFAULT '{}',
  usage_json TEXT NOT NULL DEFAULT '{}',
  result_json TEXT,
  error_code TEXT,
  checkpoint_json TEXT,
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_agent_runs_idem ON agent_runs(owner_admin_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_agent_runs_owner ON agent_runs(owner_admin_id, status);
CREATE INDEX IF NOT EXISTS idx_agent_runs_parent ON agent_runs(parent_run_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_corr ON agent_runs(correlation_id);

DROP TRIGGER IF EXISTS trg_ownership_immutable;
DROP INDEX IF EXISTS idx_ownership_owner;
ALTER TABLE ownership RENAME TO ownership_v19;
CREATE TABLE ownership (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('memory','agent','bot','run','approval','document','agentmail_inbox','job','integration_connection','agent_definition','agent_run')),
  resource_id TEXT NOT NULL,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  assigned_at TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('created','migrated','claimed','transferred')),
  PRIMARY KEY (resource_type, resource_id)
);
INSERT INTO ownership SELECT resource_type, resource_id, owner_admin_id, assigned_at, origin FROM ownership_v19;
DROP TABLE ownership_v19;
CREATE INDEX idx_ownership_owner ON ownership(owner_admin_id, resource_type);
CREATE TRIGGER trg_ownership_immutable BEFORE UPDATE ON ownership
BEGIN SELECT RAISE(ABORT, 'ownership_immutable'); END;
`,
    expect: [
      {
        table: "agent_definitions",
        type: "table",
        columns: [
          "id",
          "owner_admin_id",
          "name",
          "role",
          "description",
          "version",
          "instructions",
          "instruction_ref",
          "instruction_checksum",
          "model_preferences",
          "permitted_tools",
          "permission_scopes",
          "resource_budget",
          "execution_limits",
          "enabled",
          "metadata",
          "created_at",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "agent_runs",
        type: "table",
        columns: [
          "id",
          "definition_id",
          "definition_version",
          "owner_admin_id",
          "parent_run_id",
          "correlation_id",
          "idempotency_key",
          "objective",
          "status",
          "depth",
          "budget_json",
          "usage_json",
          "result_json",
          "error_code",
          "checkpoint_json",
          "evidence_ids",
          "created_at",
          "started_at",
          "finished_at",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "ownership",
        type: "table",
        columns: ["resource_type", "resource_id", "owner_admin_id", "assigned_at", "origin"],
        primaryKey: ["resource_type", "resource_id"],
      },
    ],
  },
  {
    // Fase 2 da evolução (docs/evolution/phase-2): Personal Knowledge Hub. Organização
    // (bibliotecas/notebooks/fontes) SOBRE o pipeline de documentos existente — as fontes
    // referenciam `documents` (chunks/embeddings/busca reutilizados). FTS5 nativo indexa os
    // fragmentos (kh_fts, rowid controlado por kh_chunk_index para remoção determinística).
    // Jobs de ingestão duráveis (kh_jobs) seguem o padrão de durable_jobs. O ownership é
    // recriado para estender o CHECK com os tipos kh_*; linhas existentes são preservadas.
    version: 21,
    name: "knowledge hub: libraries, notebooks, sources, relationships, transforms and durable ingestion jobs",
    sql: `
CREATE TABLE IF NOT EXISTS kh_libraries (
  id TEXT PRIMARY KEY,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'personal' CHECK (kind IN ('personal','project')),
  project_ref TEXT,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_admin_id, name)
);

CREATE TABLE IF NOT EXISTS kh_notebooks (
  id TEXT PRIMARY KEY,
  library_id TEXT NOT NULL REFERENCES kh_libraries(id) ON DELETE CASCADE,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  tags TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (library_id, name)
);
CREATE INDEX IF NOT EXISTS idx_kh_notebooks_library ON kh_notebooks(library_id);

CREATE TABLE IF NOT EXISTS kh_sources (
  id TEXT PRIMARY KEY,
  notebook_id TEXT NOT NULL REFERENCES kh_notebooks(id) ON DELETE CASCADE,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  document_id TEXT,
  type TEXT NOT NULL DEFAULT 'file' CHECK (type IN ('file','url','text')),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT '',
  content_hash TEXT,
  size INTEGER NOT NULL DEFAULT 0,
  mime TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  ingest_status TEXT NOT NULL DEFAULT 'pending' CHECK (ingest_status IN ('pending','processing','indexed','partial','failed','deleted')),
  index_status TEXT NOT NULL DEFAULT 'pending' CHECK (index_status IN ('pending','indexed','partial','lexical_only')),
  error_code TEXT,
  provenance TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kh_sources_notebook ON kh_sources(notebook_id);
CREATE INDEX IF NOT EXISTS idx_kh_sources_doc ON kh_sources(document_id);
CREATE INDEX IF NOT EXISTS idx_kh_sources_hash ON kh_sources(notebook_id, content_hash) WHERE content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS kh_source_content (
  source_id TEXT PRIMARY KEY REFERENCES kh_sources(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  mime TEXT NOT NULL DEFAULT 'text/plain'
);

CREATE TABLE IF NOT EXISTS kh_source_versions (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES kh_sources(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  document_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (source_id, version)
);

CREATE TABLE IF NOT EXISTS kh_chunk_index (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL REFERENCES kh_sources(id) ON DELETE CASCADE,
  document_id TEXT NOT NULL,
  chunk_id TEXT NOT NULL UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_kh_chunk_index_doc ON kh_chunk_index(document_id);

CREATE VIRTUAL TABLE IF NOT EXISTS kh_fts USING fts5(text, title);

CREATE TABLE IF NOT EXISTS kh_relationships (
  id TEXT PRIMARY KEY,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  from_type TEXT NOT NULL CHECK (from_type IN ('source','notebook','library','memory','entity','chunk')),
  from_id TEXT NOT NULL,
  relation TEXT NOT NULL,
  to_type TEXT NOT NULL CHECK (to_type IN ('source','notebook','library','memory','entity','chunk')),
  to_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'explicit' CHECK (kind IN ('explicit','inferred')),
  confidence REAL,
  provenance TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kh_rel_from ON kh_relationships(from_type, from_id);
CREATE INDEX IF NOT EXISTS idx_kh_rel_to ON kh_relationships(to_type, to_id);

CREATE TABLE IF NOT EXISTS kh_transformations (
  id TEXT PRIMARY KEY,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  op TEXT NOT NULL CHECK (op IN ('summary','topics','concepts','compare','synthesize')),
  source_ids TEXT NOT NULL DEFAULT '[]',
  params TEXT NOT NULL DEFAULT '{}',
  result TEXT NOT NULL DEFAULT '',
  citations TEXT NOT NULL DEFAULT '[]',
  executor TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kh_transformations_owner ON kh_transformations(owner_admin_id, created_at);

CREATE TABLE IF NOT EXISTS kh_jobs (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  source_id TEXT NOT NULL REFERENCES kh_sources(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','succeeded','failed')),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_until TEXT,
  checkpoint_json TEXT NOT NULL DEFAULT '{}',
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kh_jobs_claim ON kh_jobs(status, created_at);

DROP TRIGGER IF EXISTS trg_ownership_immutable;
DROP INDEX IF EXISTS idx_ownership_owner;
ALTER TABLE ownership RENAME TO ownership_v20;
CREATE TABLE ownership (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('memory','agent','bot','run','approval','document','agentmail_inbox','job','integration_connection','agent_definition','agent_run','kh_library','kh_notebook','kh_source')),
  resource_id TEXT NOT NULL,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  assigned_at TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('created','migrated','claimed','transferred')),
  PRIMARY KEY (resource_type, resource_id)
);
INSERT INTO ownership SELECT resource_type, resource_id, owner_admin_id, assigned_at, origin FROM ownership_v20;
DROP TABLE ownership_v20;
CREATE INDEX idx_ownership_owner ON ownership(owner_admin_id, resource_type);
CREATE TRIGGER trg_ownership_immutable BEFORE UPDATE ON ownership
BEGIN SELECT RAISE(ABORT, 'ownership_immutable'); END;
`,
    expect: [
      {
        table: "kh_libraries",
        type: "table",
        columns: [
          "id",
          "owner_admin_id",
          "name",
          "kind",
          "project_ref",
          "description",
          "created_at",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "kh_notebooks",
        type: "table",
        columns: [
          "id",
          "library_id",
          "owner_admin_id",
          "name",
          "description",
          "tags",
          "created_at",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "kh_sources",
        type: "table",
        columns: [
          "id",
          "notebook_id",
          "owner_admin_id",
          "document_id",
          "type",
          "title",
          "description",
          "origin",
          "content_hash",
          "size",
          "mime",
          "version",
          "ingest_status",
          "index_status",
          "error_code",
          "provenance",
          "created_at",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "kh_jobs",
        type: "table",
        columns: [
          "id",
          "idempotency_key",
          "source_id",
          "status",
          "attempts",
          "lease_until",
          "checkpoint_json",
          "last_error",
          "created_at",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "ownership",
        type: "table",
        columns: ["resource_type", "resource_id", "owner_admin_id", "assigned_at", "origin"],
        primaryKey: ["resource_type", "resource_id"],
      },
    ],
  },
  {
    // Fase 3 da evolução (docs/evolution/phase-3): Workflow & Behavior Studio. Definições
    // versionadas/imutáveis, execuções persistentes por nó, eventos, aprovações D9 e
    // políticas comportamentais. SEM terceira fila: o motor executa in-process com estado
    // persistido e recuperação no boot (ADR-WF-001). Ownership recriado com os tipos wf_*.
    version: 22,
    name: "workflow studio: versioned definitions, durable runs, node executions, events and behavior policies",
    sql: `
CREATE TABLE IF NOT EXISTS wf_definitions (
  id TEXT PRIMARY KEY,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published')),
  current_version INTEGER NOT NULL DEFAULT 0,
  allowed_tools TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_admin_id, name)
);

CREATE TABLE IF NOT EXISTS wf_definition_versions (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES wf_definitions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  graph TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (definition_id, version)
);

CREATE TABLE IF NOT EXISTS wf_runs (
  id TEXT PRIMARY KEY,
  definition_id TEXT NOT NULL REFERENCES wf_definitions(id) ON DELETE CASCADE,
  definition_version INTEGER NOT NULL,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  objective TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','waiting_approval','waiting_dependency','completed','failed','cancelled','unknown')),
  budget_json TEXT NOT NULL DEFAULT '{}',
  usage_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_wf_runs_idem ON wf_runs(owner_admin_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_wf_runs_owner ON wf_runs(owner_admin_id, status);

CREATE TABLE IF NOT EXISTS wf_node_executions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES wf_runs(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','running','waiting_approval','waiting_dependency','completed','failed','cancelled','skipped','unknown')),
  attempt INTEGER NOT NULL DEFAULT 0,
  input_json TEXT,
  output_json TEXT,
  error_code TEXT,
  approval_id TEXT,
  agent_run_id TEXT,
  wake_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (run_id, node_id)
);
CREATE INDEX IF NOT EXISTS idx_wf_nodes_run ON wf_node_executions(run_id, status);

CREATE TABLE IF NOT EXISTS wf_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES wf_runs(id) ON DELETE CASCADE,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  node_id TEXT,
  detail TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_wf_events_run ON wf_events(run_id, id);

CREATE TABLE IF NOT EXISTS wf_policies (
  id TEXT PRIMARY KEY,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0,
  scope TEXT NOT NULL CHECK (scope IN ('tool','workflow','agent')),
  target TEXT NOT NULL DEFAULT '*',
  conditions TEXT NOT NULL DEFAULT '[]',
  effect TEXT NOT NULL CHECK (effect IN ('allow','deny','require_approval')),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0,1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_admin_id, name)
);

CREATE TABLE IF NOT EXISTS wf_policy_revisions (
  id TEXT PRIMARY KEY,
  policy_id TEXT NOT NULL REFERENCES wf_policies(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE (policy_id, version)
);

DROP TRIGGER IF EXISTS trg_ownership_immutable;
DROP INDEX IF EXISTS idx_ownership_owner;
ALTER TABLE ownership RENAME TO ownership_v21;
CREATE TABLE ownership (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('memory','agent','bot','run','approval','document','agentmail_inbox','job','integration_connection','agent_definition','agent_run','kh_library','kh_notebook','kh_source','wf_definition','wf_run','wf_policy')),
  resource_id TEXT NOT NULL,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  assigned_at TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('created','migrated','claimed','transferred')),
  PRIMARY KEY (resource_type, resource_id)
);
INSERT INTO ownership SELECT resource_type, resource_id, owner_admin_id, assigned_at, origin FROM ownership_v21;
DROP TABLE ownership_v21;
CREATE INDEX idx_ownership_owner ON ownership(owner_admin_id, resource_type);
CREATE TRIGGER trg_ownership_immutable BEFORE UPDATE ON ownership
BEGIN SELECT RAISE(ABORT, 'ownership_immutable'); END;
`,
    expect: [
      {
        table: "wf_definitions",
        type: "table",
        columns: [
          "id",
          "owner_admin_id",
          "name",
          "description",
          "status",
          "current_version",
          "allowed_tools",
          "created_at",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "wf_definition_versions",
        type: "table",
        columns: ["id", "definition_id", "version", "graph", "created_at"],
        primaryKey: ["id"],
      },
      {
        table: "wf_runs",
        type: "table",
        columns: [
          "id",
          "definition_id",
          "definition_version",
          "owner_admin_id",
          "objective",
          "status",
          "budget_json",
          "usage_json",
          "error_code",
          "idempotency_key",
          "created_at",
          "started_at",
          "finished_at",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "wf_node_executions",
        type: "table",
        columns: [
          "id",
          "run_id",
          "node_id",
          "node_type",
          "status",
          "attempt",
          "input_json",
          "output_json",
          "error_code",
          "approval_id",
          "agent_run_id",
          "wake_at",
          "created_at",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "wf_policies",
        type: "table",
        columns: [
          "id",
          "owner_admin_id",
          "name",
          "description",
          "version",
          "priority",
          "scope",
          "target",
          "conditions",
          "effect",
          "enabled",
          "created_at",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "ownership",
        type: "table",
        columns: ["resource_type", "resource_id", "owner_admin_id", "assigned_at", "origin"],
        primaryKey: ["resource_type", "resource_id"],
      },
    ],
  },
  {
    // Fase 4 da evolução (docs/evolution/phase-4): Deep Research & Learning. Pesquisas com
    // fontes (web/hub) e evidências com citação verbatim; relatórios versionados; jornadas de
    // aprendizagem com módulos/lições/atividades/tentativas/diário. Reusa Hub (fontes internas),
    // Workforce (análise) e Workflow Engine (execução durável — registry de nós de pesquisa).
    // Ownership recriado com research_project/learn_project.
    version: 23,
    name: "deep research and learning: research projects, sources, evidence, claims, conflicts, reports; learning projects, modules, lessons, activities, attempts, journal",
    sql: `
CREATE TABLE IF NOT EXISTS research_projects (
  id TEXT PRIMARY KEY,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  question TEXT NOT NULL,
  scope_text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','planning','running','waiting','completed','partial','inconclusive','failed','unknown')),
  plan_json TEXT,
  config_json TEXT NOT NULL DEFAULT '{}',
  workflow_run_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_owner ON research_projects(owner_admin_id, status);

CREATE TABLE IF NOT EXISTS research_sources (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  origin TEXT NOT NULL CHECK (origin IN ('web','hub','memory')),
  url TEXT NOT NULL DEFAULT '',
  canonical_url TEXT,
  title TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT '',
  content_hash TEXT,
  snippet TEXT NOT NULL DEFAULT '',
  content TEXT,
  quality TEXT NOT NULL DEFAULT 'snippet_only' CHECK (quality IN ('full','partial','snippet_only','failed')),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  fetched_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_sources_project ON research_sources(project_id);
CREATE INDEX IF NOT EXISTS idx_research_sources_hash ON research_sources(project_id, content_hash) WHERE content_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS research_evidence (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  source_id TEXT REFERENCES research_sources(id) ON DELETE CASCADE,
  quote TEXT NOT NULL,
  location TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL DEFAULT 'direct' CHECK (type IN ('direct','indirect','inference','hypothesis','gap')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_evidence_project ON research_evidence(project_id);
CREATE INDEX IF NOT EXISTS idx_research_evidence_source ON research_evidence(source_id);

CREATE TABLE IF NOT EXISTS research_claims (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  statement TEXT NOT NULL,
  evidence_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'inferred' CHECK (status IN ('supported','unsupported','contested','inferred')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_research_claims_project ON research_claims(project_id);

CREATE TABLE IF NOT EXISTS research_conflicts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  claim_a_id TEXT REFERENCES research_claims(id) ON DELETE CASCADE,
  claim_b_id TEXT REFERENCES research_claims(id) ON DELETE CASCADE,
  description TEXT NOT NULL,
  resolution TEXT NOT NULL DEFAULT 'unresolved' CHECK (resolution IN ('unresolved','resolved_a','resolved_b','insufficient')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS research_reports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES research_projects(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE (project_id, version)
);

CREATE TABLE IF NOT EXISTS learn_projects (
  id TEXT PRIMARY KEY,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  goal TEXT NOT NULL,
  level TEXT NOT NULL DEFAULT '',
  sources_json TEXT NOT NULL DEFAULT '[]',
  plan_json TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','archived')),
  research_project_id TEXT REFERENCES research_projects(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learn_owner ON learn_projects(owner_admin_id);

CREATE TABLE IF NOT EXISTS learn_modules (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES learn_projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learn_modules_project ON learn_modules(project_id);

CREATE TABLE IF NOT EXISTS learn_lessons (
  id TEXT PRIMARY KEY,
  module_id TEXT NOT NULL REFERENCES learn_modules(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  references_json TEXT NOT NULL DEFAULT '[]',
  order_index INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learn_lessons_module ON learn_lessons(module_id);

CREATE TABLE IF NOT EXISTS learn_activities (
  id TEXT PRIMARY KEY,
  lesson_id TEXT NOT NULL REFERENCES learn_lessons(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('comprehension','multiple_choice','open_ended','application','comparison','review')),
  question TEXT NOT NULL,
  options_json TEXT NOT NULL DEFAULT '[]',
  expected_answer TEXT NOT NULL DEFAULT '',
  concept TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learn_activities_lesson ON learn_activities(lesson_id);

CREATE TABLE IF NOT EXISTS learn_attempts (
  id TEXT PRIMARY KEY,
  activity_id TEXT NOT NULL REFERENCES learn_activities(id) ON DELETE CASCADE,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  answer TEXT NOT NULL,
  feedback TEXT NOT NULL DEFAULT '',
  correct INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learn_attempts_activity ON learn_attempts(activity_id);
CREATE INDEX IF NOT EXISTS idx_learn_attempts_owner ON learn_attempts(owner_admin_id, created_at);

CREATE TABLE IF NOT EXISTS learn_journal (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES learn_projects(id) ON DELETE CASCADE,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  kind TEXT NOT NULL CHECK (kind IN ('note','doubt','discovery','difficulty','review')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_learn_journal_project ON learn_journal(project_id);

DROP TRIGGER IF EXISTS trg_ownership_immutable;
DROP INDEX IF EXISTS idx_ownership_owner;
ALTER TABLE ownership RENAME TO ownership_v22;
CREATE TABLE ownership (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('memory','agent','bot','run','approval','document','agentmail_inbox','job','integration_connection','agent_definition','agent_run','kh_library','kh_notebook','kh_source','wf_definition','wf_run','wf_policy','research_project','learn_project')),
  resource_id TEXT NOT NULL,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  assigned_at TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('created','migrated','claimed','transferred')),
  PRIMARY KEY (resource_type, resource_id)
);
INSERT INTO ownership SELECT resource_type, resource_id, owner_admin_id, assigned_at, origin FROM ownership_v22;
DROP TABLE ownership_v22;
CREATE INDEX idx_ownership_owner ON ownership(owner_admin_id, resource_type);
CREATE TRIGGER trg_ownership_immutable BEFORE UPDATE ON ownership
BEGIN SELECT RAISE(ABORT, 'ownership_immutable'); END;
`,
    expect: [
      {
        table: "research_projects",
        type: "table",
        columns: [
          "id",
          "owner_admin_id",
          "question",
          "scope_text",
          "status",
          "plan_json",
          "config_json",
          "workflow_run_id",
          "created_at",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "research_sources",
        type: "table",
        columns: [
          "id",
          "project_id",
          "owner_admin_id",
          "origin",
          "url",
          "canonical_url",
          "title",
          "domain",
          "content_hash",
          "snippet",
          "content",
          "quality",
          "metadata_json",
          "fetched_at",
          "created_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "research_evidence",
        type: "table",
        columns: ["id", "project_id", "source_id", "quote", "location", "type", "created_at"],
        primaryKey: ["id"],
      },
      {
        table: "learn_projects",
        type: "table",
        columns: [
          "id",
          "owner_admin_id",
          "goal",
          "level",
          "sources_json",
          "plan_json",
          "status",
          "research_project_id",
          "created_at",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "ownership",
        type: "table",
        columns: ["resource_type", "resource_id", "owner_admin_id", "assigned_at", "origin"],
        primaryKey: ["resource_type", "resource_id"],
      },
    ],
  },
  {
    // Fase 5 da evolução (docs/evolution/phase-5): Computer Intelligence — SESSÕES de
    // navegador isoladas (reuso do worker Playwright com D9/política existentes), capturas
    // controladas com retenção, planos/ações com verificação e recuperação, memória
    // procedural (testada/validada por execução verificada). SEM controle de desktop nativo
    // (ADR-EVO-008). Ownership recriado com ci_session/ci_procedure.
    version: 24,
    name: "computer intelligence: sessions, observations, plans, actions with verification and procedural memory",
    sql: `
CREATE TABLE IF NOT EXISTS ci_sessions (
  id TEXT PRIMARY KEY,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  environment TEXT NOT NULL DEFAULT 'browser' CHECK (environment IN ('browser','fixture')),
  objective TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','failed')),
  config_json TEXT NOT NULL DEFAULT '{}',
  usage_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT
);

CREATE TABLE IF NOT EXISTS ci_observations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES ci_sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('screenshot','extract')),
  observation_hash TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  dims_json TEXT NOT NULL DEFAULT '{}',
  artifact_path TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ci_obs_session ON ci_observations(session_id, created_at);

CREATE TABLE IF NOT EXISTS ci_plans (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES ci_sessions(id) ON DELETE CASCADE,
  objective TEXT NOT NULL,
  steps_json TEXT NOT NULL DEFAULT '[]',
  observation_id TEXT,
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','executing','done','failed','stale')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ci_actions (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL REFERENCES ci_plans(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES ci_sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  action_type TEXT NOT NULL CHECK (action_type IN ('navigate','click','fill','select','scroll','wait_for','screenshot','read','close')),
  target_json TEXT NOT NULL DEFAULT '{}',
  expected_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','running','succeeded','failed','verification_pending','unknown','reconciling','cancelled','blocked')),
  verification_json TEXT,
  error_code TEXT,
  approval_id TEXT,
  observation_before TEXT,
  observation_after TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ci_actions_plan ON ci_actions(plan_id, seq);

CREATE TABLE IF NOT EXISTS ci_procedures (
  id TEXT PRIMARY KEY,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  name TEXT NOT NULL,
  goal TEXT NOT NULL,
  environment TEXT NOT NULL DEFAULT 'browser',
  steps_json TEXT NOT NULL DEFAULT '[]',
  criteria TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'observed' CHECK (status IN ('observed','inferred','tested','validated','deprecated')),
  version INTEGER NOT NULL DEFAULT 1,
  success_count INTEGER NOT NULL DEFAULT 0,
  fail_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_admin_id, name)
);

DROP TRIGGER IF EXISTS trg_ownership_immutable;
DROP INDEX IF EXISTS idx_ownership_owner;
ALTER TABLE ownership RENAME TO ownership_v23;
CREATE TABLE ownership (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('memory','agent','bot','run','approval','document','agentmail_inbox','job','integration_connection','agent_definition','agent_run','kh_library','kh_notebook','kh_source','wf_definition','wf_run','wf_policy','research_project','learn_project','ci_session','ci_procedure')),
  resource_id TEXT NOT NULL,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  assigned_at TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('created','migrated','claimed','transferred')),
  PRIMARY KEY (resource_type, resource_id)
);
INSERT INTO ownership SELECT resource_type, resource_id, owner_admin_id, assigned_at, origin FROM ownership_v23;
DROP TABLE ownership_v23;
CREATE INDEX idx_ownership_owner ON ownership(owner_admin_id, resource_type);
CREATE TRIGGER trg_ownership_immutable BEFORE UPDATE ON ownership
BEGIN SELECT RAISE(ABORT, 'ownership_immutable'); END;
`,
    expect: [
      {
        table: "ci_sessions",
        type: "table",
        columns: [
          "id",
          "owner_admin_id",
          "environment",
          "objective",
          "status",
          "config_json",
          "usage_json",
          "created_at",
          "updated_at",
          "closed_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "ci_procedures",
        type: "table",
        columns: [
          "id",
          "owner_admin_id",
          "name",
          "goal",
          "environment",
          "steps_json",
          "criteria",
          "status",
          "version",
          "success_count",
          "fail_count",
          "last_used_at",
          "created_at",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "ci_actions",
        type: "table",
        columns: [
          "id",
          "plan_id",
          "session_id",
          "seq",
          "action_type",
          "target_json",
          "expected_json",
          "status",
          "verification_json",
          "error_code",
          "approval_id",
          "observation_before",
          "observation_after",
          "attempts",
          "created_at",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "ownership",
        type: "table",
        columns: ["resource_type", "resource_id", "owner_admin_id", "assigned_at", "origin"],
        primaryKey: ["resource_type", "resource_id"],
      },
    ],
  },
  {
    // Fase 6 da evolução (docs/evolution/phase-6): EXPERIÊNCIA MULTIMODAL — camada de
    // apresentação/entrada sobre o sistema conversacional EXISTENTE (conversations.js é a
    // fonte da verdade; NADA de histórico duplicado). Sessões multimodais com turnos
    // persistentes e eventos tipados; transcrições com correção; referências a artefatos
    // (NUNCA áudio bruto no banco — metadados bastam, ADR-MM-003); latência observada.
    version: 25,
    name: "multimodal experience: sessions, turns, typed events and transcript segments",
    sql: `
CREATE TABLE IF NOT EXISTS mm_sessions (
  id TEXT PRIMARY KEY,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','closed','failed')),
  modalities_json TEXT NOT NULL DEFAULT '[]',
  state_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mm_sessions_owner ON mm_sessions(owner_admin_id, created_at);

CREATE TABLE IF NOT EXISTS mm_turns (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES mm_sessions(id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL REFERENCES conversations(id),
  seq INTEGER NOT NULL,
  state TEXT NOT NULL DEFAULT 'idle' CHECK (state IN ('idle','listening','transcribing','processing','generating','speaking','interrupted','completed','failed')),
  input_kind TEXT NOT NULL DEFAULT 'text' CHECK (input_kind IN ('text','audio','upload')),
  input_text TEXT,
  transcript_json TEXT,
  reply_message_id TEXT,
  output_text TEXT,
  audio_meta_json TEXT,
  error_code TEXT,
  latency_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mm_turns_session ON mm_turns(session_id, seq);

CREATE TABLE IF NOT EXISTS mm_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES mm_sessions(id) ON DELETE CASCADE,
  turn_id TEXT,
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_mm_events_session ON mm_events(session_id, id);

DROP TRIGGER IF EXISTS trg_ownership_immutable;
DROP INDEX IF EXISTS idx_ownership_owner;
ALTER TABLE ownership RENAME TO ownership_v24;
CREATE TABLE ownership (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('memory','agent','bot','run','approval','document','agentmail_inbox','job','integration_connection','agent_definition','agent_run','kh_library','kh_notebook','kh_source','wf_definition','wf_run','wf_policy','research_project','learn_project','ci_session','ci_procedure','mm_session')),
  resource_id TEXT NOT NULL,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  assigned_at TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('created','migrated','claimed','transferred')),
  PRIMARY KEY (resource_type, resource_id)
);
INSERT INTO ownership SELECT resource_type, resource_id, owner_admin_id, assigned_at, origin FROM ownership_v24;
DROP TABLE ownership_v24;
CREATE INDEX idx_ownership_owner ON ownership(owner_admin_id, resource_type);
CREATE TRIGGER trg_ownership_immutable BEFORE UPDATE ON ownership
BEGIN SELECT RAISE(ABORT, 'ownership_immutable'); END;
`,
    expect: [
      {
        table: "mm_sessions",
        type: "table",
        columns: [
          "id",
          "owner_admin_id",
          "conversation_id",
          "status",
          "modalities_json",
          "state_json",
          "created_at",
          "updated_at",
          "closed_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "mm_turns",
        type: "table",
        columns: [
          "id",
          "session_id",
          "conversation_id",
          "seq",
          "state",
          "input_kind",
          "input_text",
          "transcript_json",
          "reply_message_id",
          "output_text",
          "audio_meta_json",
          "error_code",
          "latency_json",
          "created_at",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "mm_events",
        type: "table",
        columns: ["id", "session_id", "turn_id", "kind", "payload_json", "created_at"],
        primaryKey: ["id"],
      },
      {
        table: "ownership",
        type: "table",
        columns: ["resource_type", "resource_id", "owner_admin_id", "assigned_at", "origin"],
        primaryKey: ["resource_type", "resource_id"],
      },
    ],
  },
  {
    // Fase 7 da evolução (docs/evolution/phase-7): INTELIGÊNCIA PROATIVA — regras com
    // versionamento, eventos internos com deduplicação, oportunidades rastreáveis
    // (event→rule→opportunity→run→approval→result) e notificações internas. NENHUMA
    // autorização paralela: execução só via Workflow Engine (políticas+D9 nativos).
    version: 26,
    name: "proactive intelligence: versioned rules, internal events, opportunities and notifications",
    sql: `
CREATE TABLE IF NOT EXISTS pr_rules (
  id TEXT PRIMARY KEY,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  origin TEXT NOT NULL DEFAULT 'user' CHECK (origin IN ('user','derived')),
  trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('event','temporal','contextual')),
  trigger_json TEXT NOT NULL DEFAULT '{}',
  conditions_json TEXT NOT NULL DEFAULT '[]',
  workflow_id TEXT,
  params_json TEXT NOT NULL DEFAULT '{}',
  execution TEXT NOT NULL DEFAULT 'manual' CHECK (execution IN ('manual','auto')),
  valid_from TEXT,
  valid_until TEXT,
  max_executions INTEGER,
  execution_count INTEGER NOT NULL DEFAULT 0,
  cooldown_ms INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','active','paused','disabled','expired','failed')),
  version INTEGER NOT NULL DEFAULT 1,
  last_run_at TEXT,
  next_run_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_admin_id, name)
);

CREATE TABLE IF NOT EXISTS pr_rule_versions (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES pr_rules(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  author_admin_id TEXT NOT NULL REFERENCES admins(id),
  created_at TEXT NOT NULL,
  UNIQUE (rule_id, version)
);

CREATE TABLE IF NOT EXISTS pr_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  source TEXT NOT NULL CHECK (source IN ('workflow','research','learning','kh','workforce','mm','computer','manual','system')),
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  dedupe_key TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (owner_admin_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_pr_events_owner ON pr_events(owner_admin_id, created_at);

CREATE TABLE IF NOT EXISTS pr_opportunities (
  id TEXT PRIMARY KEY,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  rule_id TEXT REFERENCES pr_rules(id),
  event_id INTEGER,
  rule_version INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  justification TEXT NOT NULL DEFAULT '',
  evidence_json TEXT NOT NULL DEFAULT '[]',
  dedupe_key TEXT,
  status TEXT NOT NULL DEFAULT 'detected' CHECK (status IN ('detected','evaluating','recommended','dismissed','snoozed','accepted','executing','completed','failed','expired')),
  workflow_run_id TEXT,
  snoozed_until TEXT,
  decision_json TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pr_opp_owner ON pr_opportunities(owner_admin_id, status);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pr_opp_dedupe ON pr_opportunities(dedupe_key) WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS pr_notifications (
  id TEXT PRIMARY KEY,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  type TEXT NOT NULL CHECK (type IN ('opportunity_identified','approval_needed','routine_started','execution_completed','execution_failed','condition_changed','rule_paused','limit_reached')),
  priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  source TEXT NOT NULL DEFAULT 'proactive',
  entity_type TEXT,
  entity_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  read_at TEXT,
  expires_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pr_notif_owner ON pr_notifications(owner_admin_id, created_at);

DROP TRIGGER IF EXISTS trg_ownership_immutable;
DROP INDEX IF EXISTS idx_ownership_owner;
ALTER TABLE ownership RENAME TO ownership_v25;
CREATE TABLE ownership (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('memory','agent','bot','run','approval','document','agentmail_inbox','job','integration_connection','agent_definition','agent_run','kh_library','kh_notebook','kh_source','wf_definition','wf_run','wf_policy','research_project','learn_project','ci_session','ci_procedure','mm_session','pr_rule')),
  resource_id TEXT NOT NULL,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  assigned_at TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('created','migrated','claimed','transferred')),
  PRIMARY KEY (resource_type, resource_id)
);
INSERT INTO ownership SELECT resource_type, resource_id, owner_admin_id, assigned_at, origin FROM ownership_v25;
DROP TABLE ownership_v25;
CREATE INDEX idx_ownership_owner ON ownership(owner_admin_id, resource_type);
CREATE TRIGGER trg_ownership_immutable BEFORE UPDATE ON ownership
BEGIN SELECT RAISE(ABORT, 'ownership_immutable'); END;
`,
    expect: [
      {
        table: "pr_rules",
        type: "table",
        columns: [
          "id",
          "owner_admin_id",
          "name",
          "description",
          "origin",
          "trigger_kind",
          "trigger_json",
          "conditions_json",
          "workflow_id",
          "params_json",
          "execution",
          "valid_from",
          "valid_until",
          "max_executions",
          "execution_count",
          "cooldown_ms",
          "state",
          "version",
          "last_run_at",
          "next_run_at",
          "last_error",
          "created_at",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "pr_rule_versions",
        type: "table",
        columns: ["id", "rule_id", "version", "snapshot_json", "author_admin_id", "created_at"],
        primaryKey: ["id"],
      },
      {
        table: "pr_events",
        type: "table",
        columns: [
          "id",
          "owner_admin_id",
          "source",
          "kind",
          "payload_json",
          "dedupe_key",
          "created_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "pr_opportunities",
        type: "table",
        columns: [
          "id",
          "owner_admin_id",
          "rule_id",
          "event_id",
          "rule_version",
          "kind",
          "priority",
          "justification",
          "evidence_json",
          "dedupe_key",
          "status",
          "workflow_run_id",
          "snoozed_until",
          "decision_json",
          "expires_at",
          "created_at",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "pr_notifications",
        type: "table",
        columns: [
          "id",
          "owner_admin_id",
          "type",
          "priority",
          "source",
          "entity_type",
          "entity_id",
          "title",
          "body",
          "read_at",
          "expires_at",
          "created_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "ownership",
        type: "table",
        columns: ["resource_type", "resource_id", "owner_admin_id", "assigned_at", "origin"],
        primaryKey: ["resource_type", "resource_id"],
      },
    ],
  },
  {
    // Fase 8 da evolução (docs/evolution/phase-8): INTEGRATION FABRIC & TEMPORAL
    // INTELLIGENCE — registro de integrações com credenciais cifradas (secret-crypto
    // EXISTENTE), produtores de webhook autenticados por HMAC, eventos externos canônicos
    // (dados NÃO CONFIÁVEIS; nunca instrução), contas de calendário (provider abstrato)
    // e gatilhos temporais com timezone IANA (regra pr_rules ganha timezone + tipos de
    // recorrência estendidos). NENHUMA execução/autorização paralela: Proactive Engine +
    // Workflow Engine + D9 permanecem as únicas portas.
    version: 27,
    name: "integration fabric: integrations, webhook producers, external events, calendar accounts and tz-aware temporal triggers",
    sql: `
CREATE TABLE IF NOT EXISTS if_integrations (
  id TEXT PRIMARY KEY,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  kind TEXT NOT NULL CHECK (kind IN ('webhook','calendar','custom')),
  adapter TEXT NOT NULL,
  name TEXT NOT NULL,
  version TEXT NOT NULL DEFAULT '1',
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  config_json TEXT NOT NULL DEFAULT '{}',
  policy_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'unconfigured' CHECK (status IN ('unconfigured','configured','active','degraded','disabled','error')),
  health_json TEXT NOT NULL DEFAULT '{}',
  last_contact_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (owner_admin_id, kind, name)
);

CREATE TABLE IF NOT EXISTS if_producers (
  id TEXT PRIMARY KEY,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  integration_id TEXT NOT NULL REFERENCES if_integrations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  secret_encrypted TEXT NOT NULL,
  allowed_event_types_json TEXT NOT NULL DEFAULT '[]',
  last_event_at TEXT,
  event_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  disabled_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (integration_id, name)
);

CREATE TABLE IF NOT EXISTS if_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  producer_id TEXT NOT NULL REFERENCES if_producers(id),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  occurred_at TEXT,
  received_at TEXT NOT NULL,
  correlation_id TEXT,
  idempotency_key TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  trust_level TEXT NOT NULL DEFAULT 'untrusted' CHECK (trust_level IN ('authenticated','untrusted')),
  provenance_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','normalized','forwarded','duplicate','rejected','error')),
  error_code TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (owner_admin_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_if_events_owner ON if_events(owner_admin_id, created_at);

CREATE TABLE IF NOT EXISTS cal_accounts (
  id TEXT PRIMARY KEY,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  integration_id TEXT NOT NULL REFERENCES if_integrations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('fixture','google')),
  provider_account TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',
  sync_cursor TEXT,
  last_sync_at TEXT,
  last_error TEXT,
  status TEXT NOT NULL DEFAULT 'configured' CHECK (status IN ('configured','active','degraded','disabled','error')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (integration_id, provider_account)
);

CREATE TABLE IF NOT EXISTS cal_events (
  id TEXT PRIMARY KEY,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  account_id TEXT NOT NULL REFERENCES cal_accounts(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  starts_at_utc TEXT NOT NULL,
  ends_at_utc TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  recurrence_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  checksum TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE (account_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_cal_events_account ON cal_events(account_id, starts_at_utc);

CREATE TABLE IF NOT EXISTS cal_conflicts (
  id TEXT PRIMARY KEY,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  account_id TEXT NOT NULL REFERENCES cal_accounts(id) ON DELETE CASCADE,
  event_a TEXT NOT NULL,
  event_b TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'overlap' CHECK (kind IN ('overlap','moved','missing_update')),
  detected_at TEXT NOT NULL,
  resolved_at TEXT
);

-- pr_events: fonte CHECK ampliada para produtores do Integration Fabric (tabela recriada
-- preservando linhas; UNIQUE(owner, dedupe_key) mantida).
ALTER TABLE pr_events RENAME TO pr_events_v26;
CREATE TABLE pr_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  source TEXT NOT NULL CHECK (source IN ('workflow','research','learning','kh','workforce','mm','computer','manual','system','integrations','calendar')),
  kind TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  dedupe_key TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (owner_admin_id, dedupe_key)
);
INSERT INTO pr_events (id, owner_admin_id, source, kind, payload_json, dedupe_key, created_at)
  SELECT id, owner_admin_id, source, kind, payload_json, dedupe_key, created_at FROM pr_events_v26;
DROP TABLE pr_events_v26;
CREATE INDEX IF NOT EXISTS idx_pr_events_owner ON pr_events(owner_admin_id, created_at);

-- pr_rules: gatilhos temporais com timezone IANA do usuário (instantes continuam em UTC).
ALTER TABLE pr_rules ADD COLUMN timezone TEXT NOT NULL DEFAULT 'UTC';

DROP TRIGGER IF EXISTS trg_ownership_immutable;
DROP INDEX IF EXISTS idx_ownership_owner;
ALTER TABLE ownership RENAME TO ownership_v26;
CREATE TABLE ownership (
  resource_type TEXT NOT NULL CHECK (resource_type IN ('memory','agent','bot','run','approval','document','agentmail_inbox','job','integration_connection','agent_definition','agent_run','kh_library','kh_notebook','kh_source','wf_definition','wf_run','wf_policy','research_project','learn_project','ci_session','ci_procedure','mm_session','pr_rule','if_integration','cal_account')),
  resource_id TEXT NOT NULL,
  owner_admin_id TEXT NOT NULL REFERENCES admins(id),
  assigned_at TEXT NOT NULL,
  origin TEXT NOT NULL CHECK (origin IN ('created','migrated','claimed','transferred')),
  PRIMARY KEY (resource_type, resource_id)
);
INSERT INTO ownership SELECT resource_type, resource_id, owner_admin_id, assigned_at, origin FROM ownership_v26;
DROP TABLE ownership_v26;
CREATE INDEX idx_ownership_owner ON ownership(owner_admin_id, resource_type);
CREATE TRIGGER trg_ownership_immutable BEFORE UPDATE ON ownership
BEGIN SELECT RAISE(ABORT, 'ownership_immutable'); END;
`,
    expect: [
      {
        table: "if_integrations",
        type: "table",
        columns: [
          "id",
          "owner_admin_id",
          "kind",
          "adapter",
          "name",
          "version",
          "capabilities_json",
          "config_json",
          "policy_json",
          "status",
          "health_json",
          "last_contact_at",
          "last_error",
          "created_at",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "if_events",
        type: "table",
        columns: [
          "id",
          "owner_admin_id",
          "producer_id",
          "event_id",
          "event_type",
          "schema_version",
          "occurred_at",
          "received_at",
          "correlation_id",
          "idempotency_key",
          "payload_json",
          "trust_level",
          "provenance_json",
          "status",
          "error_code",
          "created_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "cal_accounts",
        type: "table",
        columns: [
          "id",
          "owner_admin_id",
          "integration_id",
          "provider",
          "provider_account",
          "config_json",
          "sync_cursor",
          "last_sync_at",
          "last_error",
          "status",
          "created_at",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "cal_events",
        type: "table",
        columns: [
          "id",
          "owner_admin_id",
          "account_id",
          "external_id",
          "title",
          "starts_at_utc",
          "ends_at_utc",
          "timezone",
          "recurrence_json",
          "status",
          "checksum",
          "updated_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "cal_conflicts",
        type: "table",
        columns: [
          "id",
          "owner_admin_id",
          "account_id",
          "event_a",
          "event_b",
          "kind",
          "detected_at",
          "resolved_at",
        ],
        primaryKey: ["id"],
      },
      {
        table: "ownership",
        type: "table",
        columns: ["resource_type", "resource_id", "owner_admin_id", "assigned_at", "origin"],
        primaryKey: ["resource_type", "resource_id"],
      },
    ],
  },
];

const tableExists = (db, t) =>
  !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(t);

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
  {
    needs: ["kv"],
    sql: `
INSERT OR IGNORE INTO legacy_settings (id, data)
  SELECT 1, value FROM kv WHERE key = 'settings';
INSERT OR IGNORE INTO global_settings (id, data)
  SELECT 1, json_object(
    'host', json_extract(value, '$.host'),
    'integrations', json_extract(value, '$.integrations'),
    'localVoiceUrl', json_extract(value, '$.voice.localVoiceUrl'))
  FROM kv WHERE key = 'settings';`,
  },
  {
    needs: ["bots"],
    sql: `
INSERT OR IGNORE INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin)
  SELECT 'bot', b.id, json_extract(b.data, '$.owner_admin_id'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'migrated'
  FROM bots b JOIN admins a ON a.id = json_extract(b.data, '$.owner_admin_id');`,
  },
  {
    needs: ["bots", "runs"],
    sql: `
INSERT OR IGNORE INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin)
  SELECT 'run', r.id, o.owner_admin_id, strftime('%Y-%m-%dT%H:%M:%fZ','now'), 'migrated'
  FROM runs r JOIN ownership o ON o.resource_type = 'bot' AND o.resource_id = r.bot_id;`,
  },
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
    if (!exists) {
      out[t] = null;
      continue;
    }
    const h = createHash("sha256");
    for (const row of db.prepare(`SELECT rowid AS __rowid, * FROM ${t} ORDER BY rowid`).iterate())
      h.update(JSON.stringify(row) + "\n");
    out[t] = h.digest("hex");
  }
  return out;
}
const snapshot = (db) =>
  JSON.stringify({ counts: snapshotCounts(db), content: snapshotContent(db) });
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
// Asserção de esquema por migração (P0.3.1). `CREATE TABLE IF NOT EXISTS` NÃO falha quando já
// existe QUALQUER objeto com o mesmo nome — uma VIEW homónima (ou uma tabela com estrutura
// divergente) é ignorada em silêncio e a migração "conclui" sem criar a tabela de facto (observado
// em ensaio real a 2026-10-18). Cada migração pode declarar `expect`; depois do seu SQL e antes do
// COMMIT validamos tipo, colunas e PK, e qualquer divergência aborta com rollback — nunca uma
// migração bem-sucedida sem os objetos que prometeu.
function assertObjects(db, expect) {
  for (const e of expect) {
    const found = db.prepare("SELECT type FROM sqlite_master WHERE name = ?").get(e.table);
    if (!found) throw new Error(`asserção de esquema: objeto ausente — ${e.table}`);
    if (e.type && found.type !== e.type)
      throw new Error(`asserção de esquema: ${e.table} é ${found.type}, esperado ${e.type}`);
    const cols = db.prepare(`PRAGMA table_info("${e.table}")`).all();
    const names = cols.map((c) => c.name);
    const missing = (e.columns || []).filter((c) => !names.includes(c));
    if (missing.length)
      throw new Error(
        `asserção de esquema: ${e.table} sem colunas ${missing.join(", ")} (tem: ${names.join(", ")})`,
      );
    if (e.primaryKey) {
      const pk = cols
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);
      if (JSON.stringify(pk) !== JSON.stringify(e.primaryKey))
        throw new Error(
          `asserção de esquema: PK de ${e.table} é [${pk.join(", ")}], esperado [${e.primaryKey.join(", ")}]`,
        );
    }
  }
}

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
      if (typeof m.apply === "function") {
        const encryptFn =
          opts.encryptFn || ((text) => encrypt(text, { dataDir, createKey: false }));
        m.apply(db, { dataDir, encryptFn });
      } else {
        db.exec(typeof m.sql === "function" ? m.sql(db) : m.sql);
      }
      if (m.expect) assertObjects(db, m.expect); // objetos prometidos existem mesmo (antes do COMMIT)
      if (opts.failAfterSql === m.version) throw new Error("falha simulada");
      const after = snapshot(db);
      if (before !== after) throw new Error(`migração ${m.version} alterou dados preservados`);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw new Error(
        `Migração ${m.version} (${m.name}) falhou e foi desfeita: ${e.message}. Backup verificado: ${backup}`,
      );
    }
  }
  return { from, to: currentVersion(db), backup };
}

# Migração v22 — schema completo do Workflow & Behavior Studio

Entrada: `MIGRATIONS` posição final, `server/migrations.js:1126-1339` — `version: 22` (:1131),
nome "workflow studio: versioned definitions, durable runs, node executions, events and
behavior policies" (:1132). É a migração de topo (`targetVersion()` :1435), assertado em
`tests/wf-migration.test.mjs:26`.

## Tabelas criadas (SQL :1133-1246)

### `wf_definitions` (:1134-1145)
`id` PK · `owner_admin_id` FK admins · `name` NOT NULL · `description` DEFAULT '' ·
`status` DEFAULT 'draft' CHECK `('draft','published')` · `current_version` INTEGER DEFAULT 0 ·
`allowed_tools` TEXT DEFAULT '[]' · `created_at`/`updated_at` NOT NULL ·
`UNIQUE (owner_admin_id, name)`.

### `wf_definition_versions` (:1147-1154)
`id` PK · `definition_id` FK **ON DELETE CASCADE** · `version` INTEGER NOT NULL · `graph` TEXT
NOT NULL · `created_at` NOT NULL · `UNIQUE (definition_id, version)`.

### `wf_runs` (:1156-1173)
`id` PK · `definition_id` FK CASCADE · `definition_version` INTEGER NOT NULL ·
`owner_admin_id` FK admins · `objective` DEFAULT '' · `status` DEFAULT 'queued' CHECK
`('queued','running','waiting_approval','waiting_dependency','completed','failed','cancelled','unknown')` ·
`budget_json`/`usage_json` TEXT DEFAULT '{}' · `error_code` · `idempotency_key` ·
`created_at` NOT NULL · `started_at` · `finished_at` · `updated_at` NOT NULL.

Índices:
- `idx_wf_runs_idem` — **único parcial**: `(owner_admin_id, idempotency_key) WHERE
  idempotency_key IS NOT NULL` (:1172) — base da idempotência de `startWorkflowRun`.
- `idx_wf_runs_owner (owner_admin_id, status)` (:1173).

### `wf_node_executions` (:1175-1192)
`id` PK · `run_id` FK CASCADE · `node_id` NOT NULL · `node_type` NOT NULL · `status` DEFAULT
'pending' CHECK `('pending','running','waiting_approval','waiting_dependency','completed','failed','cancelled','skipped','unknown')` ·
`attempt` INTEGER DEFAULT 0 · `input_json` · `output_json` · `error_code` · `approval_id` ·
`agent_run_id` · `wake_at` · `created_at`/`updated_at` NOT NULL · `UNIQUE (run_id, node_id)`.

Índice: `idx_wf_nodes_run (run_id, status)` (:1192).

### `wf_events` (:1194-1202)
`id` INTEGER PK AUTOINCREMENT · `run_id` FK CASCADE · `at` NOT NULL · `kind` NOT NULL ·
`node_id` NULL · `detail` TEXT DEFAULT '{}'.
Índice: `idx_wf_events_run (run_id, id)` (:1202).

### `wf_policies` (:1204-1219)
`id` PK · `owner_admin_id` FK admins · `name` NOT NULL · `description` DEFAULT '' ·
`version` INTEGER DEFAULT 1 · `priority` INTEGER DEFAULT 0 · `scope` CHECK
`('tool','workflow','agent')` · `target` DEFAULT '*' · `conditions` DEFAULT '[]' ·
`effect` CHECK `('allow','deny','require_approval')` · `enabled` DEFAULT 1 CHECK `(0,1)` ·
`created_at`/`updated_at` NOT NULL · `UNIQUE (owner_admin_id, name)`.

### `wf_policy_revisions` (:1221-1228)
`id` PK · `policy_id` FK CASCADE · `version` INTEGER NOT NULL · `snapshot` TEXT NOT NULL ·
`created_at` NOT NULL · `UNIQUE (policy_id, version)`.

### `ownership` — recriada (:1230-1245)
`DROP TRIGGER trg_ownership_immutable` + `DROP INDEX idx_ownership_owner` → `ALTER TABLE
ownership RENAME TO ownership_v21` → nova tabela com **CHECK de `resource_type` estendido**
com `wf_definition`, `wf_run`, `wf_policy` (além dos anteriores: memory, agent, bot, run,
approval, document, agentmail_inbox, job, integration_connection, agent_definition, agent_run,
kh_library, kh_notebook, kh_source) e `origin` CHECK `('created','migrated','claimed',
'transferred')` (:1233-1240) → cópia integral das linhas (:1241) → `DROP TABLE ownership_v21`
→ índice `idx_ownership_owner` e trigger de imutabilidade recriados (:1243-1245).

## Asserções `expect` (:1247-1338)

Antes do COMMIT, `assertObjects` (:1469-1493) verifica tipo, colunas e PK de `wf_definitions`,
`wf_definition_versions`, `wf_runs`, `wf_node_executions`, `wf_policies` e `ownership` —
mitigação do falso positivo de `CREATE TABLE IF NOT EXISTS` (comentário :1463-1468).

## Upgrade v21 → v22

- Uma única transação `BEGIN IMMEDIATE` ... `COMMIT` por migração (`migrate:1502-1518`), com
  `PRAGMA user_version` setado só após as verificações (:1517).
- **Backup verificado antes** (`backupAndVerify:1438-1456`): `VACUUM INTO` para
  `dataDir/backups/jarvis-<stamp>-v<from>.db`, `PRAGMA integrity_check` na cópia e comparação
  de snapshot de conteúdo (SHA-256 por linha das tabelas preservadas, `snapshotContent`
  :1417-1431).
- **Preservação de dados:** snapshot antes/depois deve ser idêntico — migração que altere
  dado preservado aborta com rollback (:1503, :1515-1516). A cópia `ownership` preserva todas
  as linhas (teste `tests/wf-migration.test.mjs:56`).
- Falha → `ROLLBACK` + erro com apontamento do backup (:1519-1524).

## Idempotência

- Migrações em si são idempotentes por versão: só rodam as com `version > user_version`
  (:1498); o SQL usa `CREATE TABLE IF NOT EXISTS` e `DROP ... IF EXISTS` para os objetos de
  ownership.
- Reexecução sobre banco já v22: `pending` vazio → retorno imediato `{from, to, backup:null}`
  (:1498-1499). Testado em `tests/wf-migration.test.mjs:45` ("backup íntegro no schema
  anterior; migração idempotente") e subida do zero (:26).
- CHECKs fechados verificados por teste (:75) e FKs/unicidades (:111).

## Idempotência aplicacional (run)

`idx_wf_runs_idem` + consulta prévia em `startWorkflowRun` (`workflow.js:771-776`) — mesma
chave do owner devolve o run original com `deduplicated: true` (teste
`tests/wf-engine.test.mjs:135-147`).

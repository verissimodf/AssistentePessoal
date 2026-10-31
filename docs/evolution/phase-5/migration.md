# Migração — schema v24 (Computer Intelligence)

Fonte: `server/migrations.js:1583-1751` (entrada `version: 24`).

## Estrutura da migração

- `version: 24`, nome "computer intelligence: sessions, observations, plans, actions with
  verification and procedural memory" (`server/migrations.js:1589-1590`).
- Comentário de contexto: reuso do worker Playwright com D9/política, sem controle de
  desktop nativo (ADR-EVO-008) e ownership recriado com `ci_session`/`ci_procedure`
  (`server/migrations.js:1584-1588`).

## Tabelas criadas

### `ci_sessions` (`:1592-1603`)
- `id` PK, `owner_admin_id` NOT NULL → `admins(id)`.
- `environment` CHECK `('browser','fixture')`, default `'browser'`.
- `objective` NOT NULL default `''`; `status` CHECK `('active','closed','failed')` default
  `'active'`.
- `config_json`/`usage_json` default `'{}'`; `created_at`, `updated_at`, `closed_at`.

### `ci_observations` (`:1605-1615`)
- `session_id` NOT NULL → `ci_sessions(id) ON DELETE CASCADE`.
- `kind` CHECK `('screenshot','extract')`; `observation_hash` NOT NULL; `content` default
  `''`; `dims_json` default `'{}'`; `artifact_path` NULLABLE (PNG removível).
- Índice `idx_ci_obs_session (session_id, created_at)` (`:1615`).

### `ci_plans` (`:1617-1625`)
- `session_id` NOT NULL → CASCADE; `objective` NOT NULL; `steps_json` default `'[]'`;
  `observation_id` NULLABLE.
- `status` CHECK `('planned','executing','done','failed','stale')` default `'planned'`.

### `ci_actions` (`:1627-1645`)
- `plan_id`/`session_id` NOT NULL → CASCADE; `seq` INTEGER NOT NULL.
- `action_type` CHECK com 9 valores (`navigate…close`, `:1632`).
- `target_json`/`expected_json` default `'{}'`.
- `status` CHECK com 9 valores (`planned…blocked`, `:1635`) default `'planned'`.
- `verification_json`, `error_code`, `approval_id`, `observation_before`, `observation_after`
  NULLABLE; `attempts` NOT NULL default 0.
- Índice `idx_ci_actions_plan (plan_id, seq)` (`:1645`).

### `ci_procedures` (`:1647-1663`)
- `owner_admin_id` NOT NULL → `admins(id)`; `name` NOT NULL; `goal` NOT NULL;
  `environment` default `'browser'`; `steps_json` default `'[]'`; `criteria` default `''`.
- `status` CHECK `('observed','inferred','tested','validated','deprecated')` default
  `'observed'`.
- `version` default 1; `success_count`/`fail_count` default 0; `last_used_at` NULLABLE.
- `UNIQUE (owner_admin_id, name)` (`:1662`).

## Alteração na `ownership` (`:1665-1680`)

Reconstrução da tabela para ampliar o CHECK de `resource_type`: agora inclui
`'ci_session'` e `'ci_procedure'` (além de todos os tipos anteriores) —
`server/migrations.js:1669`. Sequência: drop do trigger `trg_ownership_immutable`, rename
para `ownership_v23`, criação nova, cópia `INSERT INTO ownership SELECT …`, drop da tabela
antiga, recriação de `idx_ownership_owner` e do trigger de imutabilidade. Linhas e owners
preservados sem alteração (nenhuma reatribuição automática).

## Upgrade v23 → v24

Executor (`server/migrations.js:1760+` e cabeçalho `:1-11`):

1. Migrações pendentes identificadas por `PRAGMA user_version`.
2. **Backup verificado antes de qualquer mudança** (`backupAndVerify`, `:91-104`): cópia em
   `data/backups/` com checagem de integridade (`PRAGMA integrity_check`) e de
   completude (comparação de snapshot antes/depois).
3. Cada migração roda em **uma transação** (`BEGIN IMMEDIATE`); qualquer falha — inclusive
   a checagem `expect` — faz rollback e o banco permanece como estava.
4. Verificação pós-SQL via `expect` (`:1682-1750`): colunas e PK esperadas de
   `ci_sessions`, `ci_procedures`, `ci_actions` e `ownership` são conferidas por
   `assertObjects` antes do commit.
5. Tabelas em `PRESERVED` (`:13`) — kv, memories, agents, bots, runs, approvals, audit —
   devem sobreviver intactas.

Não há backfill de dados nesta migração: só DDL + reconstrução de `ownership`.

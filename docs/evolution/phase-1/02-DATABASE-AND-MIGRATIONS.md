# 02 — Banco de dados e migrações (v20)

Fonte única: bloco v20 em `server/migrations.js:763-897` (`version: 20` na linha 767). Testes:
`tests/workforce-migration.test.mjs`.

## 1. Tabela `agent_definitions`

Criada em `migrations.js:770-790`. Todas as colunas JSON são `TEXT` com string JSON
(serialização em `workforce.js:181-189`).

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | TEXT PK | `uid()` (`workforce.js:162`) |
| `owner_admin_id` | TEXT NOT NULL | FK → `admins(id)`; obrigatório (`workforce.js:136`) |
| `name` | TEXT NOT NULL | 1–80 chars (`workforce.js:137-138`); `UNIQUE (owner_admin_id, name)` (linha 789) |
| `role` | TEXT NOT NULL | DEFAULT `'specialist'`; CHECK `IN ('orchestrator','specialist','worker')` (linha 774) |
| `description` | TEXT NOT NULL DEFAULT '' | cap 2000 (`workforce.js:141`) |
| `version` | INTEGER NOT NULL DEFAULT 1 | `version + 1` a cada UPDATE (`workforce.js:273`) |
| `instructions` | TEXT NOT NULL DEFAULT '' | cap 20000 (`workforce.js:142`) |
| `instruction_ref` | TEXT (nullable) | referência de procedência; cap 200 (`workforce.js:179`) |
| `instruction_checksum` | TEXT (nullable) | **reservado** — sempre gravado `null` (`workforce.js:180`) |
| `model_preferences` | TEXT DEFAULT '{}' | `{ provider, model }` |
| `permitted_tools` | TEXT DEFAULT '[]' | validado por `sanitizeDefinitionTools` |
| `permission_scopes` | TEXT DEFAULT '[]' | validado por `sanitizeDefinitionScopes` |
| `resource_budget` / `execution_limits` | TEXT DEFAULT '{}' | recortados por `clampBudget` |
| `enabled` | INTEGER DEFAULT 0 | CHECK `IN (0,1)` (linha 785) |
| `metadata` | TEXT DEFAULT '{}' | objeto livre |
| `created_at` / `updated_at` | TEXT NOT NULL | ISO do `now()` |

Índice: `idx_agent_definitions_owner` em `(owner_admin_id)` — `migrations.js:791`.

## 2. Tabela `agent_runs`

Criada em `migrations.js:793-814`.

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | TEXT PK | — |
| `definition_id` | TEXT NOT NULL | FK → `agent_definitions(id)` **ON DELETE CASCADE** (linha 795) |
| `definition_version` | INTEGER NOT NULL | snapshot da versão usada (`workforce.js:501`) |
| `owner_admin_id` | TEXT NOT NULL | FK → `admins(id)` |
| `parent_run_id` | TEXT (nullable) | FK → `agent_runs(id)` **ON DELETE SET NULL** (linha 798) |
| `correlation_id` | TEXT NOT NULL | raiz = próprio id (`workforce.js:503`); filho herda (`workforce.js:819`) |
| `idempotency_key` | TEXT (nullable) | cap 200 (`workforce.js:504`) |
| `objective` | TEXT NOT NULL | cap 8000 (`workforce.js:505`) |
| `status` | TEXT DEFAULT 'queued' | CHECK `IN ('queued','running','awaiting_approval','completed','failed','cancelled','unknown')` (linha 802) |
| `depth` | INTEGER DEFAULT 0 | CHECK `depth >= 0` (linha 803) |
| `budget_json` / `usage_json` | TEXT DEFAULT '{}' | orçamento alocado e consumo |
| `result_json` / `checkpoint_json` / `error_code` | TEXT (nullable) | resultado, checkpoint, código de erro |
| `evidence_ids` | TEXT DEFAULT '[]' | reservado (execução grava via `recordEvidence`, não na coluna) |
| `created_at` / `updated_at` | TEXT NOT NULL | — |
| `started_at` / `finished_at` | TEXT (nullable) | preenchidos nas transições (`workforce.js:435-442`) |

### Índices (`migrations.js:815-818`)

| Índice | Tipo |
|---|---|
| `idx_agent_runs_idem` em `(owner_admin_id, idempotency_key)` **WHERE idempotency_key IS NOT NULL** | UNIQUE parcial (idempotência não colide com NULL) |
| `idx_agent_runs_owner` em `(owner_admin_id, status)` | comum |
| `idx_agent_runs_parent` em `(parent_run_id)` | comum |
| `idx_agent_runs_corr` em `(correlation_id)` | comum |

## 3. Recriação do `ownership` na v20

`migrations.js:820-835`, dentro do mesmo `sql`:

1. `DROP TRIGGER trg_ownership_immutable` e `DROP INDEX idx_ownership_owner` (820-821).
2. `ALTER TABLE ownership RENAME TO ownership_v19` (822).
3. Nova tabela com CHECK estendido: tipos `'agent_definition'` e `'agent_run'` adicionados à
   lista existente (linha 824); CHECK de `origin` ganha `'transferred'` (linha 828).
4. `INSERT INTO ownership SELECT ...` copia **todas** as linhas preservadas (831); `DROP TABLE ownership_v19` (832).
5. Recria `idx_ownership_owner` (833) e o trigger de imutabilidade `BEFORE UPDATE ... RAISE(ABORT)` (834-835).

Os tipos também estão em `TYPES`/`DATE_COL` de `server/ownership.js:17-18,26-27`.

## 4. Convenções da migração (comportamento observado)

| Convenção | Implementação |
|---|---|
| Backup verificado antes de aplicar | `backupAndVerify` (`migrations.js:1059`, `996+`); `VACUUM INTO` + `integrity_check` (`tests/workforce-migration.test.mjs:64-66`) |
| Transação única por migração | `BEGIN IMMEDIATE`/`COMMIT`/`ROLLBACK` (`migrations.js:1062-1082`) |
| Snapshot de preservação | `snapshot()` antes/depois; diferença aborta a migração (`migrations.js:1061,1073-1074`) |
| `expect` pós-SQL | `assertObjects(db, m.expect)` valida colunas/PKs de `agent_definitions`, `agent_runs`, `ownership` antes do COMMIT (`migrations.js:1071`, bloco em 837-896) |
| Idempotência | `PRAGMA user_version`; segunda execução não faz nada e não cria backup (`migrations.js:1056-1057`; teste em `workforce-migration.test.mjs:70-75`) |
| FK check limpo | `PRAGMA foreign_key_check` vazio após migrar (`workforce-migration.test.mjs:56,96`) |

## 5. Caminhos de migração

- **De v19**: `migrate` aplica só a v20; linhas de `ownership` sobrevivem à recriação
  (`workforce-migration.test.mjs:77-97`). Tabelas novas nascem vazias.
- **Banco novo (v0)**: sobe do zero até 20 num único comando; backup criado mesmo assim
  (`workforce-migration.test.mjs:38-57`).
- **Comportamento FK na aplicação**: excluir uma definition faz **cascade** nos runs
  (`workforce.js:317-318` remove ownership dos runs antes); `parent_run_id` é `SET NULL` —
  a exclusão em `deleteDefinition` apaga os runs explicitamente (`workforce.js:314-319`).

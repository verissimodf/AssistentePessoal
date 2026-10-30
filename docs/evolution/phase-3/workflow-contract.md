# Contrato de dados do Workflow Studio (schema v22)

Fonte única: migração v22 em `server/migrations.js:1126-1339` (SQL :1133-1246; asserções
`expect` :1247-1338). Tipos declarados no motor: `server/workflow.js:12-33`.

## WorkflowDefinition — `wf_definitions` (:1134-1145)

| Coluna | Tipo/Constraint |
|---|---|
| `id` | TEXT PK |
| `owner_admin_id` | TEXT NOT NULL FK `admins(id)` |
| `name` | TEXT NOT NULL · `UNIQUE(owner_admin_id, name)` |
| `description` | TEXT NOT NULL DEFAULT '' |
| `status` | TEXT NOT NULL DEFAULT 'draft' · CHECK `('draft','published')` |
| `current_version` | INTEGER NOT NULL DEFAULT 0 |
| `allowed_tools` | TEXT NOT NULL DEFAULT '[]' (JSON array de nomes de tool) |
| `created_at` / `updated_at` | TEXT NOT NULL |

Acesso via `createDefinition`/`listDefinitions`/`getDefinition`/`updateDefinition`/
`publishDefinition`/`deleteDefinition` (`server/workflow.js:133-266`); sempre filtrado por
`owner_admin_id` / `owns()` (ex. :168).

## WorkflowVersion — `wf_definition_versions` (:1147-1154) — IMUTÁVEL

| Coluna | Tipo/Constraint |
|---|---|
| `id` | TEXT PK |
| `definition_id` | FK `wf_definitions(id)` ON DELETE CASCADE |
| `version` | INTEGER NOT NULL · `UNIQUE(definition_id, version)` |
| `graph` | TEXT NOT NULL (JSON `{nodes:[], edges:[]}`) |
| `created_at` | TEXT NOT NULL |

Imutabilidade na prática: `updateDefinition` nunca reescreve uma versão — cada novo grafo cria
`current_version + 1` (`workflow.js:187-202`); o run congela `definition_version`
(`wf_runs.definition_version`, lido em `executeWorkflowRun:618-621`). Sem código no banco
que faça `UPDATE wf_definition_versions`.

## WorkflowRun — `wf_runs` (:1156-1173)

| Coluna | Tipo/Constraint |
|---|---|
| `id` | TEXT PK |
| `definition_id` | FK CASCADE |
| `definition_version` | INTEGER NOT NULL |
| `owner_admin_id` | FK `admins(id)` |
| `objective` | TEXT NOT NULL DEFAULT '' (máx 2000 em `startWorkflowRun`, `workflow.js:770`) |
| `status` | CHECK `('queued','running','waiting_approval','waiting_dependency','completed','failed','cancelled','unknown')` |
| `budget_json` | TEXT DEFAULT '{}' — snapshot de `WF_BUDGET` na criação (:781-792) |
| `usage_json` | TEXT DEFAULT '{}' — hoje só `agent_runs` (escrito em :488, :513) |
| `error_code` | TEXT NULL (`wf_timeout`, `wf_node_budget_exhausted`, `wf_agent_budget_exhausted`, `wf_definition_missing`, `interrupted`, `not_executed`, `approval_rejected`, código do nó) |
| `idempotency_key` | TEXT NULL · índice único parcial `idx_wf_runs_idem (owner_admin_id, idempotency_key) WHERE idempotency_key IS NOT NULL` (:1172) |
| `created_at` / `started_at` / `finished_at` / `updated_at` | TEXT |

Índice: `idx_wf_runs_owner (owner_admin_id, status)` (:1173).

## NodeExecution — `wf_node_executions` (:1175-1192)

| Coluna | Tipo/Constraint |
|---|---|
| `id` | TEXT PK |
| `run_id` | FK `wf_runs(id)` ON DELETE CASCADE |
| `node_id` | TEXT NOT NULL (`/^[a-zA-Z0-9_-]{1,60}$/`, `workflow.js:85`) |
| `node_type` | TEXT NOT NULL (um dos 10 tipos, `workflow.js:12-23`) |
| `status` | CHECK `('pending','running','waiting_approval','waiting_dependency','completed','failed','cancelled','skipped','unknown')` |
| `attempt` | INTEGER NOT NULL DEFAULT 0 (incrementado a cada execução, `workflow.js:581-584`) |
| `input_json` / `output_json` | TEXT NULL — checkpoint do nó |
| `error_code` | TEXT NULL (máx 60 chars, :598) |
| `approval_id` | TEXT NULL — FK lógica para `approvals` (nó approval; setado em :534) |
| `agent_run_id` | TEXT NULL — AgentRun (`agent`) ou run filho (`subworkflow`) (:594, :502, :526) |
| `wake_at` | TEXT NULL — ISO date do wait (:543-545) |
| `created_at` / `updated_at` | TEXT NOT NULL |
| — | `UNIQUE(run_id, node_id)`; índice `idx_wf_nodes_run (run_id, status)` |

## WorkflowEvent — `wf_events` (:1194-1202)

| Coluna | Tipo/Constraint |
|---|---|
| `id` | INTEGER PK AUTOINCREMENT (ordenação temporal) |
| `run_id` | FK CASCADE |
| `at` | TEXT NOT NULL |
| `kind` | TEXT NOT NULL (`created`, `node_started`, `node_completed`, `node_failed`, `approval_pending`, `approval_resolved`, `completed`, `failed`, `cancelled`, `timeout`, `reconciled` — emissores em `workflow.js:274-282` e chamadas de `emit`) |
| `node_id` | TEXT NULL |
| `detail` | TEXT NOT NULL DEFAULT '{}' (JSON) |

Índice: `idx_wf_events_run (run_id, id)`. Apenas INSERT (`emit`, `workflow.js:274-282`);
exposto em `getWfRun` (:816-820).

## ApprovalRequest (D9) — tabelas existentes `approvals` / `approval_actions`

Criado pelo nó approval em `createWorkflowApproval` (`workflow.js:381-404`):
`approvals(id, command, status='pending', created_at)` + `approval_actions(approval_id, action,
correlation_id, created_at)`, onde **`correlation_id` = id do run** e a ação embute
`workflow_node` = id do `wf_node_executions` (:394-396). Ownership `approval` atribuído ao
owner do run (:392). Status possíveis consultados pelo motor: `pending` / `done`|`approved` /
rejeição (`tickWfRuns:952-977`).

## Governance — `wf_policies` / `wf_policy_revisions`

Ver `policy-engine.md` (schema em `migrations.js:1204-1228`).

## Leitura agregada

`getWfRun` (`workflow.js:806-821`) retorna run + `nodes[]` (ordenado por `created_at`) +
`events[]` (por `id`), com `budget`/`usage` parseados (:803-804). Verificação de schema:
`tests/wf-migration.test.mjs:75-111` (CHECKs, FKs, versionamento).

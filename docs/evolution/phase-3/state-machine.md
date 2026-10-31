# Máquinas de estado — definição, run e node execution

Todos os CHECKs são reais (migração v22, `server/migrations.js`). Transições implementadas
em `server/workflow.js` via CAS (`setRunStatus` :284-303, `setNodeStatus` :305-340).

## 1. Definição — `wf_definitions.status` (CHECK `('draft','published')`, :1139)

| De | Para | Onde |
|---|---|---|
| — | `draft` | `createDefinition` insere com `status='draft'` (`workflow.js:148`) |
| `draft` → `draft` | edição de nome/descrição/allowed_tools/novo grafo | `updateDefinition` :183-234 (novo grafo cria nova **versão**) |
| `draft` ou `published` | `published` | `publishDefinition` :236-248 (revalida o grafo; publica a versão atual) |
| qualquer (sem runs ativos) | (linha removida) | `deleteDefinition` :250-266 — recusa com `wf_definition_active_runs` se houver run `queued/running/waiting_*` (:252-257) |

Não existe voltar a `draft` (nenhum código faz `status='draft'`). Versões publicadas são
imutáveis: editar cria `current_version + 1` (:187-202).

## 2. Run — `wf_runs.status` (CHECK de 8 estados, `migrations.js:1162`)

Estados: `queued`, `running`, `waiting_approval`, `waiting_dependency`, `completed`, `failed`,
`cancelled`, `unknown`.

| De | Para | Gatilho (arquivo:linha) |
|---|---|---|
| — | `queued` | `startWorkflowRun` INSERT (`workflow.js:781`) |
| `queued` | `running` | `executeWorkflowRun` `setRunStatus(..., {started:true})` (:616-617) |
| `running` | `completed` | chegou ao `end` / condition sem saída (:710, :731) |
| `running` | `failed` | nó falho propagado (:686), timeout (:652), orçamento de nós (:658), grafo ausente (:623) |
| `running` | `waiting_approval` | nó approval criou D9 (:693-699) |
| `running` | `waiting_dependency` | nó wait futuro (:693-699) |
| `waiting_approval` | `running` | tick: approval `done`/`approved` (`tickWfRuns:960`) |
| `waiting_approval` | `failed` | tick: approval rejeitado → `approval_rejected` (:964-969) |
| `waiting_dependency` | `running` | tick: `wake_at` expirado (:988) |
| `queued`/`running`/`waiting_*` | `cancelled` | `cancelWfRun` (:855-864) |
| `running` | `unknown` | boot: run órfão `running` fora de `activeWfRuns` → `error_code='interrupted'` (`recoverWfRuns:879-886`) |
| `unknown` | `waiting_approval` / `failed` | `reconcileWfRun` (:903-940) |

Regras: terminais não mudam (`cancelWfRun` retorna `unchanged`, :851-852); `unknown` não pode
cancelar — exige reconciliação (:853); `executeWorkflowRun` só admite
`queued|waiting_dependency|running` (:614).

## 3. NodeExecution — `wf_node_executions.status` (CHECK de 9 estados, `migrations.js:1180`)

Estados: `pending`, `running`, `waiting_approval`, `waiting_dependency`, `completed`, `failed`,
`cancelled`, `skipped`, `unknown`.

| De | Para | Onde |
|---|---|---|
| — | `pending` | INSERT na primeira execução do nó (`workflow.js:571-573`) |
| `pending`/`running` | `running` | `executeNodeWithState` com `attempt+1` (:580-585); transição perdida → tratada como `waiting` (outro executor) |
| `running` | `completed` | resultado do nó (:591); vínculo `agent_run_id` em seguida (:593-594) |
| `running` | `failed` | exceção no nó (:596-601) |
| `running` | `waiting_approval` | nó approval com `approval_id` (:534) |
| `running` | `waiting_dependency` | nó wait com `wake_at` (:543-545) |
| `waiting_approval` | `completed` | tick: D9 aprovado, saída `{approved:true}` (:956-958) |
| `waiting_approval` | `failed` | tick: D9 rejeitado, `approval_rejected` (:964-966) |
| `waiting_dependency` | `completed` | tick: wait expirado, saída `{waited:true}` (:985-987) |
| `pending`/`running`/`waiting_dependency` | `cancelled` | `cancelWfRun` (:856-858) |
| `running` | `unknown` | boot (`recoverWfRuns:883-885`) |
| `unknown` | `waiting_approval` / `failed` | `reconcileWfRun` (:917-936) |

`skipped` existe no CHECK e no atalho de leitura (:578) — nenhum emissor grava `skipped` hoje.

## Recovery no boot (`recoverWfRuns`, `workflow.js:873-896`)

- `running` **órfão** (id não está em `activeWfRuns`, set em memória :270/:633/:738) → run e
  nós `running` viram `unknown` com `error_code='interrupted'` (:879-886); audit
  `wf.runs_interrupted` (:887-891).
- `queued` → retomado imediatamente via `executeWorkflowRun` (nada executou — sem risco de
  replay; :892-894).
- `waiting_approval` / `waiting_dependency` **permanecem**: são estados reais persistidos
  (D9 pendente / `wake_at` futuro), retomados pelo tick (:942-992).

Chamado no boot: `server/index.js:1869`; tick a cada 20 s: `server/index.js:1871`.

## Reconciliação por evidência (`reconcileWfRun`, :903-940)

Só atua em run `unknown` (:907). Decisão baseada em evidência, não em suposição:

1. Algum nó `unknown` com `approval_id` cujo approval está `pending` → nó e run para
   `waiting_approval` (outcome `awaiting_approval`, :917-924).
2. Nenhum efeito externo pendente (`executedExternal` false, :926-927) → nós `unknown` →
   `failed not_executed` e run `failed` (outcome `not_executed`, :928-937).
3. Caso contrário → `undetermined`: permanece `unknown` para decisão do operador (:939).

Rotas: `POST /api/workflow-runs/:id/reconcile` (`server/index.js:1314-1319`, acesso `session`).
Testes: `tests/wf-engine.test.mjs:336-365` (cancelamento/reconciliação), `:367+` (boot),
`tests/wf-migration.test.mjs:75` (CHECKs fechados).

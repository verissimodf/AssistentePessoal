# Observabilidade da Fase 3

## Eventos de run — `wf_events` (append-only, `emit` em `server/workflow.js:274-282`)

| `kind` | Emitido em |
|---|---|
| `created` | início do run (`startWorkflowRun:795`) |
| `node_started` | cada execução de nó, com `type` e `attempt` (:587) |
| `node_completed` | nó completou (:592) |
| `node_failed` | exceção no nó (:599) |
| `approval_pending` | nó approval criou D9 (:535) |
| `approval_resolved` | tick resolveu — `outcome: approved\|rejected` (:959, :970) |
| `timeout` | orçamento de tempo estourado (:653) |
| `failed` | run falhou por propagação de nó (:690) |
| `completed` | run terminou (:711, :732) |
| `cancelled` | cancelamento (:865) |
| `reconciled` | reconciliação — `outcome: awaiting_approval\|not_executed` (:922, :935) |

Leitura: `GET /api/workflow-runs/:id` devolve `events[]` ordenados por `id`
(`workflow.js:816-820`). A sequência E2E esperada está assertada em
`tests/wf-security.test.mjs:226-233`.

## Auditoria imutável (`audit` de `server/db.js`)

| Grupo | Kinds |
|---|---|
| `wf.*` | `wf.definition_created` (:156), `wf.definition_updated` (:231), `wf.definition_published` (:246), `wf.definition_deleted` (:264), `wf.approval_requested` (:397), `wf.run_created` (:796), `wf.start_denied` (:758, :763), `wf.run_cancelled` (:866), `wf.runs_interrupted` (:888), `wf.run_reconciled` (:923, :936), `wf.run_failed` (:971) |
| `policy.*` | `policy.created` (:199), `policy.updated` (:254), `policy.deleted` (:265), `policy.evaluated` (cada decisão com match, :152), `policy.fail_closed` (condição inválida → deny, :147) |
| Pré-existentes relacionados | `authz.tool_denied` (negativas de `can()` e política, `tools.js:1058, 1072`), `kh.transform` (`knowledge.js:788`), `workforce.run_created` (`workforce.js:528`) |

## Cadeia de rastreabilidade

```
WorkflowRun (wf_runs.id)
  └─ NodeExecution (wf_node_executions.run_id, approval_id, agent_run_id)
       ├─ AgentRun (workforce: agent_runs, correlation_id próprio)   [nós agent/subworkflow]
       ├─ PolicyEvaluation (audit policy.evaluated/fail_closed)      [toda decisão]
       ├─ Approval D9 (approvals + approval_actions, correlation_id = run)  [nó approval]
       └─ Evidence (execution_evidence: correlation = run_id, approval_id)  [efeitos]
```

- `correlation_id` do D9 = id do run (`workflow.js:394`); `workflow_node` embutido na ação
  (:395).
- `agent_run_id` persistido no nó (:594, :502, :526).
- Evidência por `correlation` e por `approval_id` assertada em `tests/wf-security.test.mjs:217-225`.

## Métricas consultáveis hoje

- **Contagem por status de run:** `listWfRuns(adminId, { status, definitionId, limit, offset })`
  (`workflow.js:823-844`) — rota `GET /api/workflow-runs?status=...`
  (`index.js:1295-1302`), com `has_more`.
- **Estado detalhado por run:** nós (status/attempt/error_code) e eventos via
  `GET /api/workflow-runs/:id` (`workflow.js:806-821`).
- **Consumo de orçamento:** `usage_json.agent_runs` e `budget_json` expostos em cada run
  (`runRow:803-804`).
- **Decisões de política:** tabela `audit` (`kind='policy.evaluated'`, `detail` com efeito) —
  consultável por SQL, como faz o teste `tests/wf-security.test.mjs:276-281`.
- **Aprovações pendentes:** `GET /api/approvals` (`index.js:456-457`).

## O que NÃO existe (honesto)

- **Séries temporais/telemetria persistida de métricas:** não há endpoint ou tabela de
  métricas agregadas (latência, taxas de sucesso/false-success) — a Fase 0 (ADR-EVO-009)
  condiciona baselines à telemetria persistida planejada (F3.5), ainda não implementada.
- **Contadores de uso além de `agent_runs`:** a UI exibe `tool_calls`/`model_calls`/
  `estimated_tokens` (`src/routes/workflows.tsx:696-697`), mas o motor não os popula hoje
  (`workflow.js` só grava `agent_runs` em :488 e :513).
- **Streaming/WS de eventos:** a UI faz polling dos runs (`refreshRuns`,
  `workflows.tsx:235`); não há push de eventos.
- **Exportação de evidências em lote:** evidência é consultável aprovação a aprovação
  (`GET /api/approvals/:id/evidence`, `index.js:451`).

# Integração com agentes — nós `agent` e `subworkflow`

## Nó `agent` (`server/workflow.js:479-503`)

Executa um **AgentRun real** da Workforce (Fase 1) — não é simulação:

1. **Orçamento:** lê `wf_runs.usage_json`, recusa em `WF_BUDGET.max_agent_runs` (10) com
   `wf_agent_budget_exhausted`, então incrementa `agent_runs` e persiste (:481-491).
2. **Disparo:** `startRun({ adminId: owner, definitionId, objective, principal, agentRunner })`
   de `server/workforce.js:464` (:492-498).
   - `startRun` aplica as próprias verificações: definição habilitada (:476), políticas
     `kind:"agent"` — `deny` → `workforce_policy_denied`, `require_approval` →
     `workforce_require_approval_unsupported` (fail-closed, ADR-WF-002) (:479-482),
     idempotência (:485-490) e **interseção de escopos** `permission_scopes ∩` escopos do
     principal do workflow (:491-495).
   - `objective` suporta interpolação `$node.*` (:495) — saídas de nós anteriores alimentam o
     objetivo do especialista.
   - `agentRunner` é injetável para testes (runner fake, `tests/wf-engine.test.mjs:60`,
     `tests/wf-security.test.mjs:60-66`).
3. **Falha:** erro do `startRun` → exceção `wf_agent_start_failed:<código>` → nó `failed`,
   run `failed` (:499, propagação em :684-691).
4. **Saída/vínculo:** nó completa com `{ agent_run, status }` e o id é persistido em
   `wf_node_executions.agent_run_id` (:500-503; gravação em :593-594).

Comportamento assíncrono: `startRun` dispara `executeRun` em background
(`workforce.js:535`) — o workflow registra o vínculo e segue; não bloqueia pela conclusão do
AgentRun.

## Nó `subworkflow` (`server/workflow.js:505-528`)

- Consome o **mesmo** orçamento `max_agent_runs` do run pai (:506-516).
- Chama `startWorkflowRun(owner, config.definition_id, { objective, principal, depth+1,
  agentRunner })` (:517-522) — a definição filha precisa estar `published`
  (checagem em :751) e passa pelas mesmas políticas `kind:"workflow"`.
- Profundidade limitada por `WF_BUDGET.max_depth` (3) na entrada de `executeWorkflowRun`
  (:609, :38).
- Saída `{ workflow_run, status }` + `agent_run_id` = run filho (:524-527).

## Principal e limites do AgentRun

- O principal repassado é o do workflow (`bot wf:<runId>`, escopos derivados de
  `allowed_tools`, `workflow.js:672-679`) — o filho nunca recebe mais do que o pai tem
  (interseção em `workforce.js:491-495`; ADR-WF-004).
- Orçamento/profundidade do AgentRun vêm do `resource_budget` da definição do especialista
  (`clampBudget`, `workforce.js:496, 513-521`).
- AgentRun criado com `correlation_id` = próprio id e ownership do admin
  (`workforce.js:498-527`); audit `workforce.run_created` com `scopes` efetivos (:528-534).

## Evidência

- O AgentRun produz evidência própria pelo pipeline da Workforce (verificador nomeado,
  ADR-EVO-009); o teste de aceite conta evidências por `correlation = run_id` do workflow e
  por `approval_id` (`tests/wf-security.test.mjs:217-225`).
- O vínculo `wf_node_executions.agent_run_id` permite rastrear AgentRun ← NodeExecution ←
  WorkflowRun (ver `observability.md`).

## Cobertura em testes

- `tests/wf-engine.test.mjs:266-298` — AgentRun real criado e vínculo persistido.
- `tests/wf-engine.test.mjs:398+` — subworkflow: limite de profundidade e orçamento de
  `agent_runs`.
- `tests/wf-security.test.mjs:75-236` — E2E: knowledge_search → agent (Workforce) →
  approval D9 → retomada → evidências; inclui definição de especialista com
  `permission_scopes: ["kh:read"]` e `permitted_tools: ["notebook_search"]` (:104-119).

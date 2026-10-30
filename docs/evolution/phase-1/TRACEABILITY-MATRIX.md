# Matriz de Rastreabilidade — Fase 1

Rastreabilidade: critério de DoD (mandato §16) → implementação → testes.

## Banco

| Critério | Implementação | Testes |
|---|---|---|
| Migração v20 implementada | `server/migrations.js` (version: 20) | `tests/workforce-migration.test.mjs` |
| AgentDefinition persistida | `server/workforce.js` (createDefinition etc.) | `workforce-core` §definitions |
| AgentRun persistida | `server/workforce.js` (startRun/executeRun) | `workforce-core` §execução |
| Ownership enforce | `assignNew("agent_definition"/"agent_run")` + TYPES (`server/ownership.js`) | `workforce-core`, `workforce-security` |
| Upgrade testado | migrate v19→v20 e banco limpo | `workforce-migration` |
| Nenhum dado perdido | snapshot PRESERVED + backup verificado | `workforce-migration` (snapshotCounts) |

## Orçamentos

| Critério | Implementação | Testes |
|---|---|---|
| Alocação hierárquica | `allocateChildBudget` (nível restante por `max_depth`) | `workforce-core` (delegação) |
| Contabilidade concorrente | `BEGIN IMMEDIATE` + fórmula `alloc − usage − Σ filhos` | `workforce-core` (paralelas ≤ pai) |
| Limites enforce | `max_tool_calls`/`max_model_calls`/`runtime_ms` no `runAgent` + contagens estruturais | `workforce-core` |
| Exaustão tratada | recusa tipada `workforce_budget_exhausted` | `workforce-core` (exaustão) |
| Retry contabilizado | `max_retries` reservado; retry automático NÃO implementado (limitação documentada em `09`) | — |

## Execução

| Critério | Implementação | Testes |
|---|---|---|
| Máquina de estados persistente | `TRANSITIONS` + `setRunStatus` condicional | `workforce-core` (transições ilegais recusadas via reconcile duplo) |
| Checkpointing | `onProgress` → `checkpoint_json` | `workforce-core` |
| Idempotência | índice parcial UNIQUE + retorno do run existente | `workforce-core`, `workforce-security` |
| Unknown suportado | `recoverWorkforceRuns` no boot | `workforce-core` (crash/boot) |
| Reconciliação operacional | `reconcileRun` por evidência autoritativa | `workforce-core` + `workforce-security` |
| Cancelamento controlado | `cancelWorkforceRun` + `cancelRun` (AbortController) | `workforce-core` |
| Sem replay cego | unknown → só reconciliação; efeito nunca re-executado | `workforce-core`, `workforce-security` |

## Workforce

| Critério | Implementação | Testes |
|---|---|---|
| Coordinator | `executeRun`/`delegate` (workforce.js) | `workforce-core` |
| Specialist definitions | CRUD + 5 templates | `workforce-core` |
| Delegação | tool `delegate_agent` (`server/tools.js`) | `workforce-core` |
| Autorização do filho independente | interseção escopos pedidos ∩ pai, revalidada por `callTool` | `workforce-core` (host:run removido), `workforce-security` |
| Troca estruturada de resultados | `formatDelegateResult` (JSON + untrusted marker) | `workforce-core` |
| Consolidação | `result.children` + limitações | `workforce-core` |
| Falhas parciais representadas | `limitations[]`, `verification` partial/none | `workforce-core` |

## Segurança

| Critério | Testes |
|---|---|
| Ownership/autorização/escalada/orçamento/evidência | `workforce-security` (401/403/404/409; principals forjados; `confirm` sem evidência) |
| Controles existentes intactos | suíte completa 713/713 (nenhum teste de segurança alterado — só 2 contagens documentadas) |

## Aplicação

| Critério | Implementação | Testes |
|---|---|---|
| API autenticada | 10 rotas em `server/index.js` (seção Workforce) | `workforce-security` (E2E HTTP) |
| UI integrada | `src/routes/workforce.tsx` + nav/i18n/bridge | `src/test/workforce-ui.test.tsx` (113/113) |
| Estados corretos na UI | `workforceStatusBadge` (verificado vs. concluído distintos) | `workforce-ui` |

## Validação / Git

- Suítes: backend 713/713 · frontend 113/113 · eval 6/6 · tsc/lint/build/compose/imagem OK —
  evidência completa em [`08-TESTING-AND-VALIDATION.md`](08-TESTING-AND-VALIDATION.md).
- Branch dedicada, sem push/PR/merge; SHA final no relatório executivo da sessão.

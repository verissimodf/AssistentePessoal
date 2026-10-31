# Matriz de Rastreabilidade — Fase 3

Critérios de aceite (mandato §12) → implementação → testes.

| Critério | Implementação | Testes |
|---|---|---|
| Motor durável de workflows funcional | `server/workflow.js` (executor in-process sobre estado persistido) | `wf-engine` |
| Contratos versionados | `wf_definitions`/`wf_definition_versions` (v22) | `wf-migration`, `wf-engine` |
| Versões publicadas imutáveis | `publishDefinition` → snapshot em `wf_definition_versions` | `wf-engine` (3 versões) |
| Máquina de estados validada | CHECKs + `setRunStatus`/`setNodeStatus` atômicos | `wf-migration`, `wf-engine` |
| Checkpoints persistentes | `wf_node_executions` (status/output por nó) + retomada pulando concluídos | `wf-engine` |
| Recuperação segura | `recoverWfRuns` no boot (running→unknown; queued retomado; waiting_* permanecem) | `wf-engine` (boot) |
| Unknown + reconciliação | `reconcileWfRun` por evidência (pending approval → waiting; sem efeito → failed; efeito iniciado → operador) | `wf-engine`, `wf-security` |
| Nós agent integrados ao Workforce | `executeNode('agent')` → `startRun` com orçamento | `wf-engine`, `wf-security` (demo) |
| Nós de conhecimento integrados ao Hub | `executeNode('knowledge_search'/'transform')` via khSearch/khTransform | `wf-engine`, `wf-security` (citação) |
| Orçamento e limites preservados | WF_BUDGET (runtime/max_nodes/max_agent_runs/max_depth) + orçamento hierárquico da Fase 1 | `wf-engine` (subworkflow, falha) |
| Aprovações integradas ao D9 | `createWorkflowApproval` → tabela approvals real + resolução pelas rotas existentes | `wf-engine`, `wf-security` |
| Aprovações vinculadas ao contexto | `approval_id` por node execution + `approval_actions.correlation_id` = run | `wf-security` (cross-run) |
| Autorização revalidada antes da ação | `callTool` revalida + `resolveApproval` revalida gate/fingerprint | `wf-security` |
| Policy engine no backend | `server/policies.js` + hooks em callTool/startWorkflowRun/startRun | `policies` |
| ALLOW / DENY / REQUIRE_APPROVAL | decisões implementadas + force_approval/negação sem D9 | `policies` |
| Fail-closed | condição inválida → DENY auditado (antes do skip de lista vazia) | `policies` |
| Auditoria das decisões | `policy.evaluated` / `policy.fail_closed` / `wf.*` no audit | `policies`, `wf-security` |
| Workflow Studio funcional | `src/routes/workflows.tsx` (editor estruturado, publicar, executar, histórico, cancelar, reconciliar) | `workflow-ui.test` |
| Policy Studio funcional | `src/routes/policies.tsx` (CRUD + simulador) | `workflow-ui.test` |
| Migração validada | v22 limpo + upgrade + idempotência | `wf-migration` |
| Testes de segurança aprovados | cross-owner, forjados, replay, bypass | `wf-security`, `policies` |
| Regressão Fases 0-2 | backend 765/765 · frontend 121/121 · eval 6/6 | [`testing.md`](testing.md) |
| Documentação completa | 20 documentos + ADR-WF-001..005 | links verificados |
| Commit local revisado | diff revisado, sem segredos | relatório executivo |
| Working tree limpa | pós-commit | confirmado |

Não concluído (documentado, não reduzido): [`limitations.md`](limitations.md) — joins de múltiplos
pais, expiração de aprovação, require_approval para início de execução, políticas globais,
editor visual, streaming de progresso.

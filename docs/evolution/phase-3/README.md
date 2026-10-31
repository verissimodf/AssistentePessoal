# Fase 3 — Workflow & Behavior Studio (J.A.R.V.I.S. Evolution)

**Status:** implementada · **Branch:** `evolution/phase-3-workflow-behavior-studio-20261030` · **Base:** `5a40f47` (Fase 2)
**Escopo:** motor de workflows duráveis com definições versionadas imutáveis, execução
persistente por nó, aprovações D9 como fronteira, policy engine determinístico no backend e
duas áreas no painel (Workflow Studio e Policy Studio).

## Documentos

| Documento | Conteúdo |
|---|---|
| [`architecture.md`](architecture.md) | Componentes e fluxo ponta a ponta |
| [`workflow-contract.md`](workflow-contract.md) | Definições, versões, runs, nós, eventos |
| [`workflow-engine.md`](workflow-engine.md) | Execução durável, ondas, interpolação, orçamento |
| [`state-machine.md`](state-machine.md) | Estados/transições, recovery, reconciliação |
| [`node-types.md`](node-types.md) | Os 10 tipos de nós |
| [`approval-d9.md`](approval-d9.md) | Nó de aprovação e integração D9 |
| [`policy-engine.md`](policy-engine.md) | Políticas, decisões, fail-closed |
| [`authorization-model.md`](authorization-model.md) | Fronteiras de autorização |
| [`agent-integration.md`](agent-integration.md) | Nós agent/subworkflow (Workforce) |
| [`knowledge-integration.md`](knowledge-integration.md) | Nós de Knowledge Hub |
| [`observability.md`](observability.md) | Eventos, auditoria, métricas |
| [`api-contracts.md`](api-contracts.md) | Rotas /api/workflows*, /api/policies* |
| [`ui-operations.md`](ui-operations.md) | Workflow Studio e Policy Studio |
| [`security-threat-model.md`](security-threat-model.md) | 13 ameaças WF + invariantes |
| [`migration.md`](migration.md) | Schema v22 |
| [`testing.md`](testing.md) | Suítes e resultados reais |
| [`decisions.md`](decisions.md) | ADR-WF-001..005 |
| [`traceability-matrix.md`](traceability-matrix.md) | Critérios → implementação → testes |
| [`limitations.md`](limitations.md) | Limitações reais e itens adiados |

## Resumo de uma linha

Definições de workflow versionadas (draft→publicação imutável) executam grafos de nós
(agent/tool/condition/knowledge/approval/wait/subworkflow) com estado persistido, retomada por
checkpoint, aprovações D9 reais como fronteira e um policy engine backend (ALLOW/DENY/
REQUIRE_APPROVAL, fail-closed, deny-prevalece) — sem terceira fila de jobs e sem caminho
alternativo de autorização.

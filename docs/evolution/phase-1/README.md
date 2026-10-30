# Fase 1 — Agent Workforce (J.A.R.V.I.S. Evolution)

**Status:** implementada · **Branch:** `evolution/phase-1-agent-workforce-20261030` · **Base:** `37fe628` (Fase 0)
**Escopo:** Workforce de agentes persistente, com orçamento hierárquico, delegação segura,
execução recuperável e reconciliação de estados desconhecidos — implementada sobre a
infraestrutura existente (Node 22 + SQLite, sem novos serviços).

## Entregáveis

| # | Documento | Conteúdo |
|---|-----------|----------|
| 00 | [`00-EXECUTIVE-SUMMARY.md`](00-EXECUTIVE-SUMMARY.md) | Veredito, capacidades entregues, riscos, prontidão da Fase 2 |
| 01 | [`01-AGENT-WORKFORCE-ARCHITECTURE.md`](01-AGENT-WORKFORCE-ARCHITECTURE.md) | Arquitetura da camada e integração com o que já existia |
| 02 | [`02-DATABASE-AND-MIGRATIONS.md`](02-DATABASE-AND-MIGRATIONS.md) | Migração v20: schemas, índices, constraints |
| 03 | [`03-AGENT-DEFINITION-AND-RUN-CONTRACTS.md`](03-AGENT-DEFINITION-AND-RUN-CONTRACTS.md) | Contratos implementados e simplificações vs. Fase 0 |
| 04 | [`04-HIERARCHICAL-BUDGETS.md`](04-HIERARCHICAL-BUDGETS.md) | Orçamento hierárquico: fórmula, atomicidade, recusas |
| 05 | [`05-EXECUTION-STATE-AND-RECOVERY.md`](05-EXECUTION-STATE-AND-RECOVERY.md) | Máquina de estados, checkpoints, cancelamento, reconciliação |
| 06 | [`06-DELEGATION-AND-SECURITY.md`](06-DELEGATION-AND-SECURITY.md) | Delegação, principal tipado, invariantes, ameaças cobertas |
| 07 | [`07-API-AND-USER-INTERFACE.md`](07-API-AND-USER-INTERFACE.md) | Rotas da API e área do painel |
| 08 | [`08-TESTING-AND-VALIDATION.md`](08-TESTING-AND-VALIDATION.md) | Suítes, cobertura por categoria, resultados reais |
| 09 | [`09-PHASE-1-OPERATIONS.md`](09-PHASE-1-OPERATIONS.md) | Operação, troubleshooting, limitações conhecidas |
| 10 | [`10-PHASE-1-FINAL-REPORT.md`](10-PHASE-1-FINAL-REPORT.md) | Relatório final executivo |
| — | [`TRACEABILITY-MATRIX.md`](TRACEABILITY-MATRIX.md) | Rastreabilidade DoD → implementação → testes |
| — | `adr/` | Nenhum ADR novo necessário (ver `00` §Decisões) |

## Resumo de uma linha

Especialistas persistentes (`agent_definitions`, v20) executam objetivos em runs duráveis
(`agent_runs`) com orçamento herdado e atômico, delegação limitada em profundidade/escopo,
idempotência por chave, cancelamento cooperativo, `unknown` + reconciliação auditada baseada em
evidência — tudo sob o choke point de autorização e o D9 existentes.

## Convenções

pt-BR, referências `arquivo:linha` verificadas, limitações documentadas honestamente
(tokens estimados; `max_retries` e `instruction_checksum` reservados para fases seguintes).

# Fase 0 — Arquitetura e Segurança (J.A.R.V.I.S. Evolution)

**Status:** concluída (design) · **Branch:** `evolution/phase-0-architecture-security-20261030` · **Base:** `9aad596` (1.10.0)
**Modo:** apenas documentação e validação — nenhuma mudança de comportamento de produto.

## Escopo

Auditoria das capacidades existentes do AssistentePessoal, avaliação de cinco projetos de
referência, desenho da arquitetura-alvo para a evolução multi-agente, contratos formais
(Agente/Workflow/Memória), modelo de ameaças STRIDE e backlog de implementação para as fases
seguintes. Nenhuma funcionalidade da Fase 1+ foi implementada aqui.

## Entregáveis

| # | Documento | Conteúdo |
|---|-----------|----------|
| 00 | [`00-EXECUTIVE-SUMMARY.md`](00-EXECUTIVE-SUMMARY.md) | Recomendação, veredito arquitetural, riscos, prontidão da Fase 1 |
| 01 | [`01-EXISTING-CAPABILITY-INVENTORY.md`](01-EXISTING-CAPABILITY-INVENTORY.md) | Inventário de 25 domínios com classificação e referências |
| 02 | [`02-CURRENT-ARCHITECTURE.md`](02-CURRENT-ARCHITECTURE.md) | Arquitetura as-is, fluxos, limites de confiança |
| 03 | [`03-TARGET-ARCHITECTURE.md`](03-TARGET-ARCHITECTURE.md) | Contextos delimitados, estratégia de tecnologia |
| 04 | [`04-AGENT-AND-WORKFLOW-CONTRACTS.md`](04-AGENT-AND-WORKFLOW-CONTRACTS.md) | AgentDefinition, AgentRun, Task, Workflow, orçamentos |
| 05 | [`05-KNOWLEDGE-AND-MEMORY-ARCHITECTURE.md`](05-KNOWLEDGE-AND-MEMORY-ARCHITECTURE.md) | Memória episódica/semântica/procedural, Knowledge Hub |
| 06 | [`06-SECURITY-THREAT-MODEL.md`](06-SECURITY-THREAT-MODEL.md) | Modelo de ameaças STRIDE, 20 cenários, invariants |
| 07 | [`07-REFERENCE-PROJECT-ASSESSMENT.md`](07-REFERENCE-PROJECT-ASSESSMENT.md) | DeepTutor, AutoGPT, Open Notebook, Parlant, Agent S |
| 08 | [`08-IMPLEMENTATION-ROADMAP.md`](08-IMPLEMENTATION-ROADMAP.md) | Backlog por fase, dependências, critérios de aceite |
| 09 | [`09-PHASE-0-VALIDATION-REPORT.md`](09-PHASE-0-VALIDATION-REPORT.md) | Resultados reais de validação |
| — | [`TRACEABILITY-MATRIX.md`](TRACEABILITY-MATRIX.md) | Rastreabilidade requisito→design→controle→ADR→backlog |
| — | [`adr/`](adr/) | 10 ADRs (ADR-EVO-001 a ADR-EVO-010) |

## Convenções

Documentação em português do Brasil, com identificadores técnicos em inglês onde são padrão da
engenharia. Toda afirmação arquitetural importante referencia caminho de repositório real
(`arquivo:linha`) ou está explicitamente marcada como proposta. SHAs de referências externas
foram verificados na data da pesquisa (2026-10-30) e registrados em `07`.

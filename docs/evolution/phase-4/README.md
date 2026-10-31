# Fase 4 — Deep Research & Learning (J.A.R.V.I.S. Evolution)

**Status:** implementada · **Branch:** `evolution/phase-4-deep-research-learning-20261030` · **Base:** `5a05ca5` (Fase 3)
**Escopo:** investigação aprofundada (multi-fonte web + Knowledge Hub, evidências com citação
verbatim validada, relatórios versionados) e aprendizagem assistida (jornadas, tutor,
exercícios, diário, progresso explícito) — como WORKFLOWS da Fase 3, sem runtime novo.

## Documentos

| Documento | Conteúdo |
|---|---|
| [`architecture.md`](architecture.md) | Componentes e fluxo ponta a ponta |
| [`web-search-provider.md`](web-search-provider.md) | Interface de provedor substituível (ADR-RS-001) |
| [`web-retrieval-security.md`](web-retrieval-security.md) | Recuperação controlada (SSRF, limites) |
| [`research-engine.md`](research-engine.md) | Ciclo de investigação (workflow durável) |
| [`research-planning.md`](research-planning.md) | Plano como hipótese |
| [`agent-coordination.md`](agent-coordination.md) | Especialistas e Workforce |
| [`evidence-model.md`](evidence-model.md) | Evidência verbatim, tipos, origem |
| [`source-evaluation.md`](source-evaluation.md) | Qualidade, conflitos, incerteza |
| [`grounded-reports.md`](grounded-reports.md) | Relatórios versionados com citações |
| [`workflow-integration.md`](workflow-integration.md) | Registry de nós (Fase 3) |
| [`learning-engine.md`](learning-engine.md) | Aprendizagem assistida |
| [`learning-paths.md`](learning-paths.md) | Jornadas, módulos, lições |
| [`tutor.md`](tutor.md) | Tutor contextual |
| [`assessments.md`](assessments.md) | Exercícios e avaliações formativas |
| [`learning-journal.md`](learning-journal.md) | Diário e progresso |
| [`security-threat-model.md`](security-threat-model.md) | 11 ameaças P4 + invariantes |
| [`api-contracts.md`](api-contracts.md) | Rotas /api/research* e /api/learn* |
| [`testing.md`](testing.md) | Suítes e resultados reais |
| [`decisions.md`](decisions.md) | ADR-RS-001..005 |
| [`traceability-matrix.md`](traceability-matrix.md) | Critérios → implementação → testes |
| [`limitations.md`](limitations.md) | Limitações reais e itens adiados |

## Resumo de uma linha

Investigações (pergunta → plano-hipótese → busca web/hub → recuperação controlada → evidências
com citação VERBATIM validada → síntese com claims/conflitos → relatório versionado com citações
autoritativas) rodam como workflows duráveis da Fase 3; o Learning Studio transforma fontes em
jornadas (módulos/lições), tutor com citações, exercícios com feedback e diário — progresso é
contagem explícita, nunca "domínio" inventado; sem provedor configurado a indisponibilidade é
explícita (nunca resultado fictício).

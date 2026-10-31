# Matriz de Rastreabilidade — Fase 4

Critérios de aceite (mandato §16) → implementação → testes.

## Deep Research

| Critério | Implementação | Testes |
|---|---|---|
| Provedor web estruturado integrado | `webSearchStructured` (`server/research-search.js`) + nó `research_web` | `research-engine` |
| Interface substituível | contrato único + `setSearchFetcher` (injeção) | `research-engine` (fixtures) |
| Falha explícita sem provedor | `unavailable` + audit `research.web_unavailable` | `research-engine` (indisponibilidade) |
| Recuperação segura de páginas | `retrievePage` (assertSafeUrl/assertPublicHost/safeFetch, htmlToText) | `research-engine`, `research-security` |
| Proteção SSRF | urlpolicy (loopback/privadas/portas/esquemas) | `research-engine`, `kh-security` |
| Pipeline durável | workflow auto-gerado `research:<id>` (v22) | `research-engine` |
| Planejamento/decomposição | `generatePlan` (subquestions ≤5, kind hypothesis) | `research-engine` |
| Busca combinada interna+externa | nós `research_hub` + `research_web` com origem marcada | `research-engine` (proveniência) |
| Coordenação de especialistas | nós agent via Workforce (Fase 1) + one-shots escopados | `wf-engine`, `research-security` |
| Evidências persistidas | `research_evidence` com citação verbatim | `research-engine` |
| Contradições identificadas | `research_conflicts` (síntese declara; resolução `unresolved` default) | `research-engine` |
| Incerteza explicitada | tipos de evidência + status partial/inconclusive | `research-engine` |
| Relatórios com citações verificáveis | `research_reports` versionadas, citações = registros de fonte | `research-engine`, `research-security` |
| Retomada segura | idempotência/dedupe + retomada de workflow por checkpoint | `research-engine` (deepen) |
| Orçamento respeitado | RESEARCH_LIMITS + WF_BUDGET | `research-engine` |

## Learning Engine

| Critério | Implementação | Testes |
|---|---|---|
| Jornadas persistentes | `learn_projects` (v23) + ownership | `learning` |
| Módulos e lições | `learn_modules`/`learn_lessons` gerados do plano | `learning` |
| Tutor contextual | `tutorAsk` (contexto da lição, distinção didático/fato) | `learning`, `research-security` |
| Referências rastreáveis | `references_json` das lições + citações do tutor | `learning` |
| Exercícios funcionais | `generateActivities`/`listActivities` (6 tipos) | `learning` |
| Feedback fundamentado | `submitAttempt` (grounded na resposta esperada + lição) | `learning` |
| Tentativas persistidas | `learn_attempts` (correct true/false/null) | `learning` |
| Diário | `learn_journal` (kinds fechados) | `learning` |
| Progresso rastreável | `learningProgress` (contagens explícitas) | `learning` |
| Integração Knowledge Hub | fontes do Hub no plano (owner-scoped) | `learning`, `research-security` |
| Memória sem duplicação | nada automático; escrita explícita permanece kh:write/remember | `kh-workforce` (nota hostil) |

## Plataforma

| Critério | Implementação | Testes |
|---|---|---|
| Workflow Studio integrado | nós de pesquisa no registry + execução via workflow | `research-engine` |
| Agent Workforce integrado | nós agent + orçamento + interseção de escopos | `wf-engine`, `research-engine` |
| Policy Engine/D9 integrados | política no callTool/startRun/startWorkflowRun; D9 intacto | `policies`, `wf-security` |
| Migrações validadas | v23 limpo + upgrade v22→v23 + idempotência | `kh-migration`-padrão (wf/kh agnósticos) |
| Interface funcional + i18n | `src/routes/research.tsx` + `learning.tsx` (pt/en/es) | `research-ui.test` (127/127) |
| Segurança aprovada | P4-1..P4-11 | `research-security`, `security-threat-model.md` |
| Regressão Fases 0-3 | backend 783/783 · frontend 127/127 · eval 6/6 | [`testing.md`](testing.md) |
| Documentação completa | 24 documentos + ADR-RS-001..005 | links verificados |
| Commit local revisado | diff revisado, sem segredos | relatório executivo |

Não concluído (documentado, não reduzido): [`limitations.md`](limitations.md) — provedor API de
busca (sem credenciais), ciclos automáticos múltiplos, detector independente de contradições,
edição manual de jornada, rastreamento de domínio, narração além do TTS existente.

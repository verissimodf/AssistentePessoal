# Motor de Pesquisa — Fase 4

Implementação: `server/research.js`. ADR-RS-002 (investigação = workflow da Fase 3, sem executor próprio).

> Nota de rastreabilidade: o documento de mandato com a lista numerada de etapas não está no
> repositório; abaixo está o ciclo COMPLETO implementado, na ordem de execução real, mapeado em
> código. Itens F4.1–F4.4 do roadmap: `docs/evolution/phase-0/08-IMPLEMENTATION-ROADMAP.md:48-55`.

## 1. Ciclo implementado (etapas mapeadas no código)

| # | Etapa | Código |
|---|---|---|
| 1 | Criar projeto (`question` ≤2000, `scope`, `config`), status `draft`, ownership | `research.js:70-92` |
| 2 | Listar/obter projeto com fontes, evidências, claims, conflitos e relatórios | `research.js:94-137` |
| 3 | Gerar plano via one-shot (`subquestions` ≤5, `strategy`, `sufficiency`, `kind:'hypothesis'`) → status `planning` | `research.js:142-171` |
| 4 | Executar: exige plano; recusa se `running`/`waiting` | `research.js:183-191` |
| 5 | Injeção de fixtures (fetcher/one-shot) antes de iniciar o run; remoção em `finally` | `research.js:193-216` |
| 6 | Criar/reutilizar definição auto-gerada `research:<projectId>` (grafo de 6 nós) e publicar | `research.js:225-269` |
| 7 | Iniciar run com principal de serviço escopado (`kh:read`, `web`) | `research.js:270-272`, `173-178` |
| 8 | Nó `research_hub`: `khSearch` do owner (limite 5) → fontes `origin:'hub'` | `research.js:292-309` |
| 9 | Nó `research_web`: busca web por subpergunta → fontes `origin:'web'` com dedupe por hash | `research.js:312-384` |
| 10 | Nó `research_retrieve`: recupera até 12 páginas pendentes (urlpolicy), atualiza qualidade/hash | `research.js:387-412` |
| 11 | Nó `research_evidence`: extração VERBATIM validada; alucinação rejeitada e auditada | `research.js:415-461` |
| 12 | Nó `research_synthesis`: claims (status por tipo de evidência) + conflitos declarados | `research.js:464-525` |
| 13 | Nó `research_report`: relatório versionado com citações dos registros de fonte | `research.js:528-597` |
| 14 | Status final do projeto: `completed` / `partial` / `inconclusive` | `research.js:587-594` |
| 15 | Aprofundamento: `deepenResearch` adiciona subpergunta ao plano e re-executa (novo run) | `research.js:618-638` |
| 16 | Registro dos 6 executores no Workflow Engine com erro encapsulado `research_node_error:*` | `research.js:600-615` |

## 2. Limites (`RESEARCH_LIMITS`, `research.js:19-24`)

| Limite | Valor |
|---|---|
| `max_subquestions` | 5 |
| `max_sources_per_question` | 5 |
| `max_retrievals_per_project` | 12 (por invocação do nó retrieve) |
| `max_evidence_per_source` | 5 |

Outros tetos: claims ≤20 e conflitos ≤10 por síntese (`research.js:488,510`); conteúdo de fonte
100 KB (`research.js:400`); orçamento do workflow herdado (`workflow.js:44-49`).

## 3. Status finais (`research.js:587-594`)

| Status | Condição |
|---|---|
| `completed` | ao menos 1 evidência `direct` |
| `partial` | há evidências, mas todas `indirect` (ou web indisponível com hub parcial) |
| `inconclusive` | síntese sem evidência nenhuma (`research.js:471-476`) |

Estados intermediários do CHECK: `draft`, `planning`, `running`, `waiting`, `failed`, `unknown`
(`migrations.js:1354`).

## 4. Idempotência e retomada

- Segunda execução com run em andamento → `research_already_running` (`research.js:191`).
- Run existente (`workflow_run_id`) → `executeWorkflowRun` retoma, pulando nós concluídos (`research.js:209-212`; `workflow.js:620-654`).
- Duplicatas de fonte ignoradas por hash/URL único (`research.js:379-381`).
- Aprofundamento zera `workflow_run_id` e gera nova versão de relatório (`research.js:634-637`); testado em `tests/research-engine.test.mjs:267-318`.

## 5. Testes do motor

`tests/research-engine.test.mjs`: ciclo completo com workflow real (`:149-201`), proveniência hub
(`:203-243`), indisponibilidade → parcial/inconclusivo (`:245-265`), deepen/versionamento (`:267-318`).
E2E HTTP: `tests/research-security.test.mjs:146-199`.

# Integração com o Workflow Engine — Fase 4

ADR-RS-002: a investigação é um workflow da Fase 3, sem executor próprio.

## 1. Registry de nós (extensão mínima ao Engine)

| API | Comportamento | Código |
|---|---|---|
| `registerNodeType(type)` | adiciona tipo válido ao `NODE_TYPES` (regex `^[a-z_]{1,40}$`) — usado por `validateGraph` | `workflow.js:25-27` |
| `registerNodeExecutor(type, fn)` | registra o tipo E o executor `(node, nodeExec, ctx) => output` no `NODE_REGISTRY` | `workflow.js:29-33` |

- Base nativa permanece: `start, end, agent, tool, condition, transform, knowledge_search, approval, wait, subworkflow` (`workflow.js:12-23`).
- Os 6 executores de pesquisa são registrados no carregamento do módulo, com encapsulamento de erro `research_node_error:*` (≤40 chars) (`research.js:600-615`).

## 2. Os 6 nós de pesquisa

| Tipo | Função | Efeito | Saída |
|---|---|---|---|
| `research_hub` | `research.js:292-309` | fontes do Hub do owner via `khSearch` (limite 5) | `{hub_sources}` |
| `research_web` | `research.js:312-348` | busca estruturada por subpergunta | `{sources_added, web_unavailable}` |
| `research_retrieve` | `research.js:387-412` | recupera páginas pendentes (urlpolicy) | `{retrieved, failed}` |
| `research_evidence` | `research.js:415-461` | extração verbatim validada | `{evidence_added, evidence_rejected}` |
| `research_synthesis` | `research.js:464-525` | claims + conflitos | `{claims, conflicts}` |
| `research_report` | `research.js:528-597` | relatório versionado + status final | `{report_version, status}` |

Resolução do projeto: `config.project_id` do nó ou lookup reverso por `workflow_run_id` (`research.js:276-289`).

## 3. Workflow auto-gerado

- Definição com nome único `research:<projectId>`, criada UMA vez por projeto (reuso em re-execuções) (`research.js:225-229`).
- Grafo fixo: `start-0 → hub-1 → web-2 → fetch-3 → ev-4 → syn-5 → rep-6 → end-7`, cada nó com `config:{project_id}` (`research.js:230-250`).
- `allowed_tools: ["web_search","notebook_search"]`; definição publicada antes do run (`research.js:260-269`).
- Run iniciado com `objective = pergunta` e principal de serviço `{type:"service", tokenId:"research", scopes:["kh:read","web"]}` (`research.js:270-272,173-178`).

## 4. O que é herdado da Fase 3

| Mecanismo | Herança | Código |
|---|---|---|
| Checkpoint por nó | nós concluídos pulados na retomada; saídas reconstruídas | `workflow.js:620-654` |
| Idempotência | `idempotency_key` em `startWorkflowRun` (reuso do mecanismo v22) | `workflow.js:783-788` |
| Retomada pós-crash | `recoverWfRuns` no boot para runs `unknown` | `workflow.js:885` |
| Reconciliação | `reconcileWfRun` decide por evidência, sem replay cego | `workflow.js:915` |
| Cancelamento cooperativo | `cancelWfRun`; `unknown` exige reconciliação | `workflow.js:859-875` |
| Orçamento | `WF_BUDGET` (10 min, 50 nós, 10 agent_runs, depth 3) e timeout por run | `workflow.js:44-49,663-675` |
| Políticas | `evaluatePolicies` no início do run; `deny` bloqueia, `require_approval` é negado (fail-closed) | `workflow.js:764-781` |
| Escopos | derivados de `allowed_tools` no backend; `can()` rechecado no callTool | `workflow.js:55-64` |
| Observabilidade | `wf_events`/`wf_node_executions` do run de pesquisa | `workflow.js:818-833` |

## 5. Testes

- Run real `wf_runs.status='completed'` por trás da investigação: `tests/research-engine.test.mjs:197-201`.
- Retomada sem duplicar fontes + versões de relatório: `tests/research-engine.test.mjs:267-318`.
- Replay/idempotência (P4-11): `security-threat-model.md` linha 18.

# Contratos de API — Fase 4

Rotas declaradas em `server/index.js` (seções `index.js:1388-1444` e `1446-1543`). Escopo exigido
na sessão/token (`auth.js:52-56`); ownership sempre checado no módulo (cross-owner → 404 uniforme).
Mapas de erro: `researchError` (`index.js:1389-1402`) e `learnError` (`index.js:1447-1462`).

## 1. Deep Research

| Método/Rota | Escopo | Corpo | Resposta | Erros (status) |
|---|---|---|---|---|
| `GET /api/research` | `research:read` | query `limit` (1..100, default 50), `offset` | `{items, has_more}` (`research.js:129-137`) | — |
| `POST /api/research` | `research:write` | `{question, scope?, config?}` | projeto criado (`draft`) (`research.js:70-92`) | `research_question_required` (400), `research_owner_required` (403) |
| `GET /api/research/:id` | `research:read` | — | projeto + `sources`, `evidence`, `claims`, `conflicts`, `reports` (`research.js:94-127`) | `not_found` (404) |
| `POST /api/research/:id/plan` | `research:write` | — | `{plan:{subquestions,strategy,sufficiency,kind:"hypothesis"}}` (`research.js:142-171`) | `not_found` (404), `research_already_planned` (409), `research_plan_invalid`/`research_plan_empty` (502) |
| `POST /api/research/:id/execute` | `research:write` | — | `{run, project}` (`research.js:183-218`) | `not_found` (404), `research_plan_required`/`research_already_running` (409) |
| `POST /api/research/:id/deepen` | `research:write` | `{question}` | `{run, project}` — novo run com subpergunta extra (`research.js:618-638`) | idem execute + `research_plan_required` (409) |
| `GET /api/research/:id/report` | `research:read` | — | relatório mais recente + `citations` (`index.js:1436-1444`) | `not_found` (404) se sem projeto ou sem relatório |

## 2. Learning Studio

| Método/Rota | Escopo | Corpo | Resposta | Erros (status) |
|---|---|---|---|---|
| `GET /api/learn` | `learn:read` | — | array de projetos (`learning.js:96-101`) | — |
| `POST /api/learn` | `learn:write` | `{goal, level?, sourceIds?, researchProjectId?}` | projeto (`draft`) (`learning.js:40-66`) | `learn_goal_required` (400), `learn_owner_required` (403) |
| `GET /api/learn/:id` | `learn:read` | — | projeto + `modules` → `lessons` (com `references`, `activity_count`) (`learning.js:71-94`) | `not_found` (404) |
| `DELETE /api/learn/:id` | `learn:write` | — | `{ok:true}` (`learning.js:375-383`) | `not_found` (404) |
| `POST /api/learn/:id/path` | `learn:write` | — | projeto `ready` com jornada (`learning.js:104-169`) | `not_found` (404), `learn_already_generated` (409), `learn_generation_invalid`/`learn_generation_empty` (502) |
| `POST /api/learn/:id/tutor` | `learn:read` | `{question, lesson_id?}` | `{answer, references, sufficient}` (`learning.js:181-208`) | `learn_question_required` (400), `not_found` (404) |
| `POST /api/learn/:id/journal` | `learn:write` | `{kind, content}` | `{id, kind, content, created_at}` (`learning.js:321-332`) | `learn_journal_kind_invalid`/`learn_content_required` (400), `not_found` (404) |
| `GET /api/learn/:id/journal` | `learn:read` | — | array de entradas (`learning.js:334-341`) | `not_found` (404) |
| `GET /api/learn/:id/progress` | `learn:read` | — | contagens por módulo/lição (`learning.js:344-373`) | `not_found` (404) |
| `POST /api/learn/lessons/:id/activities` | `learn:write` | `{count?}` | `{created:[ids]}` (`learning.js:221-258`) | `not_found` (404), `learn_generation_invalid` (502) |
| `GET /api/learn/lessons/:id/activities` | `learn:read` | — | array com `options` parseadas (`learning.js:260-272`) | `not_found` (404) |
| `POST /api/learn/activities/:id/attempt` | `learn:write` | `{answer}` | `{id, correct: true\|false\|null, feedback}` (`learning.js:275-315`) | `learn_answer_required` (400), `not_found` (404) |

## 3. Notas transversais

- Escopos em tokens/sessões: `research:read`, `research:write`, `learn:read`, `learn:write` (`auth.js:52-56`); tokens não recebem escopos admin-only (`auth.js:58-64`).
- Um erro interno de um-shot indisponível chega como 502 (`research_plan_invalid` etc.) — nunca como sucesso parcial mascarado.
- Auditoria das rotas: eventos `research.*`/`learn.*` só com metadados (`tests/research-security.test.mjs:258-266`).
- Run de workflow completo (nós/eventos) consulta-se pelas rotas existentes da Fase 3 (`/api/workflow-runs*`); `executeResearch` não o devolve (`research.js:220-222`).

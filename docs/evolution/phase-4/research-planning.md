# Planejamento da Investigação — Fase 4

Implementação: `generatePlan` em `server/research.js:142-171`. LLM via one-shot (`kh-oneshot.js:5-22`),
injetável para testes (`setOneShot`, `research.js:47-49`).

## 1. Pré-condições

| Condição | Erro |
|---|---|
| projeto não é do admin | `not_found` (`research.js:143`) |
| status fora de `draft`/`planning` | `research_already_planned` (`research.js:145`) |

## 2. Prompt e contrato do plano

Prompt enviado (`research.js:147-149`): pergunta + escopo + instrução de JSON
`{"subquestions": ["..."], "strategy": "...", "sufficiency": "critério de suficiência"}`,
máximo 5 subperguntas, e a declaração explícita de que **"O plano é HIPÓTESE de investigação, não fato."**

Parsing: `extractJson` extrai o primeiro objeto `{...}` da resposta (`research.js:59-63`).

## 3. Estrutura persistida (`plan_json`, `research.js:153-168`)

| Campo | Limite | Observação |
|---|---|---|
| `subquestions` | array ≤5 itens, cada ≤300 chars | truncado a `RESEARCH_LIMITS.max_subquestions` (`research.js:154-156`) |
| `strategy` | ≤1000 chars | |
| `sufficiency` | ≤500 chars | critério declarado de suficiência |
| `kind` | sempre `"hypothesis"` | plano NÃO é fato (`research.js:159`) |

Ao salvar: status do projeto → `planning` (`research.js:166-168`), audit `research.planned` com
contagem (`research.js:169`).

## 4. Falhas explícitas

| Situação | Resultado |
|---|---|
| resposta sem JSON válido | audit `research.plan_failed` com `status:"invalid_json"` + erro `research_plan_invalid` (`research.js:161-164`) |
| zero subperguntas úteis | erro `research_plan_empty` (`research.js:165`) |
| HTTP | `research_plan_invalid`/`research_plan_empty` → 502; `research_already_planned` → 409 (`index.js:1394-1398`) |

## 5. Uso do plano na execução

- `nodeResearchWeb` itera `plan.subquestions` (≤5) e faz uma busca estruturada por subpergunta; sem plano, usa o objetivo do run como subpergunta única (`research.js:314-318`).
- `deepenResearch` anexa a subpergunta extra (≤300 chars, respeitando o teto de 5) ao plano e zera `workflow_run_id` para novo run (`research.js:627-636`).

## 6. Testes

| Cenário | Teste |
|---|---|
| Plano com fixture, `kind:'hypothesis'`, status `planning` | `tests/research-engine.test.mjs:160-166` |
| Regeneração recusada após plano | (learning análogo) `tests/learning.test.mjs:121-125` |
| E2E: plano via API com 1 subpergunta e `kind:'hypothesis'` | `tests/research-security.test.mjs:156-164` |

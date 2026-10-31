# Jornadas de Aprendizagem — Fase 4

Implementação: `generateLearningPath` em `server/learning.js:104-169`.

## 1. Criação do projeto

`createLearningProject` (`learning.js:40-66`):

| Campo | Regra |
|---|---|
| `goal` | obrigatório, ≤1000 chars (`learn_goal_required`) |
| `level` | opcional, ≤60 chars |
| `sourceIds` | ≤20 ids de fontes do Knowledge Hub (`learning.js:57`) |
| `researchProjectId` | opcional — vincula a jornada a uma investigação da Fase 4 (FK `ON DELETE SET NULL`, `migrations.js:1434`) |
| status inicial | `draft` |

## 2. Contexto: fontes do Hub (owner-scoped)

- Cada `sourceId` é resolvido com `getKhSource(adminId, sid)` — leitura owner-scoped (`learning.js:110-112`).
- Até 6 chunks por documento (`document_chunks` filtrado por `admin_id`, `learning.js:113-118`).
- Cada bloco de contexto entra no prompt marcado **"DADO NÃO CONFIÁVEL"**, truncado a 6.000 chars (`learning.js:119-124`). Conteúdo do Hub nunca sai da máquina (`security-threat-model.md` P4-7).

## 3. Geração via one-shot

Prompt (`learning.js:128-130`): objetivo + nível declarado + fontes; contrato JSON
`{"modules":[{"title","description","lessons":[{"title","content","references":[...]}]}]}`,
máximo **6 módulos, até 6 lições cada**, e a instrução **"Referências devem citar apenas fontes fornecidas."**

## 4. Estrutura persistida (real)

| Entidade | Campos gravados | Limite |
|---|---|---|
| `learn_modules` | `title` ≤200, `description` ≤1000, `order_index` | ≤6 módulos (`learning.js:138`) |
| `learn_lessons` | `title` ≤200, `content` ≤20.000, `references_json` (array de strings ≤200), `order_index` | ≤6 lições/módulo (`learning.js:146`) |

Gravação atômica em transação + status do projeto → `ready` (`learning.js:140-166`).
Leitura: `getLearningProject` retorna a árvore módulos → lições com `references` e `activity_count` (`learning.js:71-94`).

## 5. Status e idempotência

| Situação | Resultado |
|---|---|
| projeto não é do admin | `not_found` (`learning.js:105`) |
| status ≠ `draft` | erro `learn_already_generated` (`learning.js:107`) — regenerar exige novo projeto (`limitations.md` item 7) |
| JSON inválido do modelo | audit `learn.plan_failed` (`status:"invalid_json"`) + `learn_generation_invalid` (`learning.js:132-137`) |
| zero módulos | `learn_generation_empty` (`learning.js:139`) |
| HTTP | 409 (`learn_already_generated`) / 502 (`learn_generation_invalid`/`empty`) (`index.js:1454-1456`) |

Transição válida: `draft → ready` (CHECK do banco admite ainda `archived`, sem caminho de escrita hoje — `migrations.js:1433`).

## 6. Testes

| Cenário | Teste |
|---|---|
| Plano com fixture, árvore módulos/lições, referências, regeneração recusada | `tests/learning.test.mjs:108-126` |
| Fontes do Hub entram no plano com proveniência (sources_json persistido) | `tests/learning.test.mjs:128-154` |
| E2E via API: `POST /api/learn/:id/path` → `ready` + módulos | `tests/research-security.test.mjs:210-214` |

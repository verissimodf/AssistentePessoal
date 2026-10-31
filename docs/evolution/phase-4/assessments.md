# Atividades e Tentativas — Fase 4

Implementação: `generateActivities`, `listActivities`, `submitAttempt` em `server/learning.js:212-315`.

## 1. Tipos válidos (`ACTIVITY_TYPES`, `learning.js:212-219`)

Mesma allowlist do CHECK da tabela (`migrations.js:1464`):

`comprehension` · `multiple_choice` · `open_ended` · `application` · `comparison` · `review`

## 2. `generateActivities(adminId, lessonId, {count})` (`learning.js:221-258`)

- Lição inexistente → `{error:"not_found"}` (`learning.js:222-223`).
- Prompt: conteúdo da lição (≤6.000 chars, "DADO NÃO CONFIÁVEL") + contrato JSON
  `{"activities":[{"type","question","options","expected","concept"}]}`; `count` efetivo = min(count||3, 6) (`learning.js:225-227`).
- Validação na persistência: só entra atividade com `type` na allowlist e `question` não vazia; inválidas descartadas (`learning.js:235-236`).
- Campos gravados: `question` ≤2000, `options` (strings ≤200), `expected_answer` ≤2000, `concept` ≤120 (`learning.js:238-250`).
- Audit `learn.activities_generated` com ids (≤10) e contagem (`learning.js:252-256`).
- Erro de parse → `learn_generation_invalid` (HTTP 502, `index.js:1455`).

## 3. `listActivities(adminId, lessonId)` (`learning.js:260-272`)

- Ownership verificado por JOIN `lessons → modules → projects.owner_admin_id` — lição de outro owner → `null` (HTTP 404) (`learning.js:262-267`).
- Retorna atividades com `options` parseadas.

## 4. `submitAttempt(adminId, activityId, {answer})` (`learning.js:275-315`)

Fluxo:

1. Atividade + conteúdo da lição via JOIN; inexistente → `not_found` (`learning.js:276-281`).
2. Ownership: projeto pai da lição checado com `owns` (`learning.js:282-287`).
3. `answer` obrigatório ≤5000 chars; vazio → throw `learn_answer_required` (`learning.js:288-289`).
4. Prompt de avaliação: enunciado, **resposta esperada marcada "DADO NÃO CONFIÁVEL"**, trecho da lição (≤4.000 chars) e a resposta do estudante; contrato JSON `{"correct": true|false|null, "feedback"}` — "null = não é possível determinar objetivamente" (`learning.js:291-292`).
5. Feedback **fundamentado**: o modelo avalia contra a resposta esperada E a lição (`learning.js:292`).
6. Parse falho → veredicto `{"correct":null, feedback:"Não foi possível gerar feedback estruturado."}` (`learning.js:294-299`).

## 5. Semântica de `correct` (`learning.js:300`)

| Valor | Significado |
|---|---|
| `true` (1) | correta |
| `false` (0) | incorreta |
| `null` (NULL) | indeterminável — nunca chutado (ADR-RS-004) |

Resposta da rota: `{id, correct: boolean|null, feedback}` (`learning.js:310-314`).
Audit `learn.attempt` com status `correct`/`incorrect`/`undetermined` (`learning.js:305-309`).

## 6. Impacto no progresso

`learningProgress` conta `attempts`/`correct`/`incorrect`/`undetermined` por lição — sem inferir
domínio (`learning.js:344-373`; `learning-engine.md` §3).

## 7. Testes

| Cenário | Teste |
|---|---|
| Geração de 3 atividades, tipos e options corretos | `tests/learning.test.mjs:169-178` |
| Tentativa correta/incorreta/`null` com feedback | `tests/learning.test.mjs:180-198` |
| Progresso por contagens (attempts=3, correct=1, incorrect=1, undetermined=1) | `tests/learning.test.mjs:200-205` |
| E2E: activities + attempt via HTTP | `tests/research-security.test.mjs:225-242` |

# Tutor Contextual — Fase 4

Implementação: `tutorAsk` em `server/learning.js:181-208`.

## 1. Contrato

| Parâmetro | Regra |
|---|---|
| `projectId` | obrigatório; ownership checado (`owns`, `learning.js:186`) — cross-owner → `not_found` |
| `question` | obrigatório, ≤2000 chars, trim; vazio → throw `learn_question_required` (`learning.js:187-188`) |
| `lessonId` | opcional; seleciona a lição de contexto (`learning.js:191-197`) |

One-shot injetável (`oneShotFn`) para testes; produção usa `tokenId:"learning"`, `scopes:["kh:read"]`
(`learning.js:28-36,198`).

## 2. Contexto da lição

Se `lessonId` corresponde a uma lição existente:

- Conteúdo entra no prompt como `Lição atual "<título>" (DADO NÃO CONFIÁVEL)`, truncado a 6.000 chars (`learning.js:194`).
- As `references_json` da lição são devolvidas na resposta como `references` (`learning.js:195,205`) — referências declaradas na geração da jornada (`learning-paths.md` §4), não citações recalculadas.

## 3. Distinção exigida do tutor (a/b/c)

O prompt instrui (`learning.js:200`):

| (a) | conteúdo presente nas fontes/lições — **com citação** |
|---|---|
| (b) | explicação didática do próprio tutor — diferenciada de fato |
| (c) | o que NÃO está nas fontes — declarado |

E veda: "Nunca apresente conteúdo gerado como se estivesse literalmente nas fontes." Instrução de
sistema do one-shot reforça: responder só a partir dos trechos, citar `[fonte, chunk N]`, declarar
"Fontes insuficientes" quando faltar evidência (`kh-oneshot.js:18-20`).

Invariante da fase: "O tutor distingue (a) conteúdo de fonte, (b) didática, (c) ausência na fonte"
(`security-threat-model.md` §Invariantes 6).

## 4. Resposta

```json
{ "answer": "texto em etapas com exemplos", "references": ["Apostila SQL"], "sufficient": true }
```

- `answer`: texto do modelo (`answer.answer ?? ""`, `learning.js:204`).
- `references`: array da lição usada (vazio sem `lessonId`).
- `sufficient`: heurística simples sobre o texto em `learning.js:206` — valor informativo limitado (ver §6).

Audit `learn.tutor` com ids do projeto, sem conteúdo (`learning.js:202`).

## 5. Sem conversa persistente própria

Cada pergunta é um one-shot independente; histórico longo usa o chat normal e o diário registra o
que o usuário quiser guardar (`limitations.md` item 8).

## 6. Limitações reais

- `sufficient` é calculado por regex no próprio `answer` (`learning.js:206`); não é verificação de
  fundamentação independente.
- O didático do modelo não é verificável automaticamente — confiança vem do prompt + revisão humana.

## 7. Testes

| Cenário | Teste |
|---|---|
| Tutor cita lições; didático diferenciado; referências da lição devolvidas | `tests/learning.test.mjs:156-167` |
| E2E via API: `POST /api/learn/:id/tutor` com resposta marcando "(a)/(b)" | `tests/research-security.test.mjs:215-223` |

# Diário de Aprendizagem — Fase 4

Implementação: `addJournalEntry`/`listJournal` em `server/learning.js:319-341`.
Tabela `learn_journal` (`migrations.js:1485-1493`). Roadmap F4.4: "Nada persiste sem confirmação
humana" (`docs/evolution/phase-0/08-IMPLEMENTATION-ROADMAP.md:55`) — aqui a confirmação é o próprio
ato do usuário criar a entrada via API/UI.

## 1. Kinds válidos (`JOURNAL_KINDS`, `learning.js:319`)

Mesma allowlist do CHECK da tabela (`migrations.js:1489`):

| Kind | Uso típico |
|---|---|
| `note` | anotação livre |
| `doubt` | dúvida registrada |
| `discovery` | descoberta do estudante |
| `difficulty` | dificuldade encontrada |
| `review` | item para revisão |

## 2. `addJournalEntry(adminId, projectId, {kind, content})` (`learning.js:321-332`)

| Regra | Comportamento |
|---|---|
| ownership | `owns(learn_project)` — cross-owner → `{error:"not_found"}` (`learning.js:322`) |
| `kind` inválido | throw `learn_journal_kind_invalid` (HTTP 400, `index.js:1457`) — ex.: `kind:"fato"` recusado (`tests/learning.test.mjs:224-227`) |
| `content` | obrigatório, ≤10.000 chars, trim; vazio → throw `learn_content_required` (`learning.js:324-325`) |
| gravação | INSERT com `owner_admin_id` do autor + audit `learn.journal_entry` (`learning.js:327-330`) |

## 3. `listJournal(adminId, projectId)` (`learning.js:334-341`)

- Owner-only: retorna `null` (HTTP 404) se o projeto não é do admin (`learning.js:337`).
- Entradas ordenadas por `created_at DESC`, campos `id, kind, content, created_at`.

## 4. O diário NÃO é fato

- Entradas são texto **declarado pelo usuário** — nenhum mecanismo as transforma em evidência,
  claim, fato ou memória do sistema (ADR-RS-004; `learning-engine.md` §3).
- Não alimentam o tutor, o plano nem o progresso: `generateLearningPath`, `tutorAsk` e
  `learningProgress` não leem `learn_journal` (`learning.js:104-373`).
- Nada vira memória automática: o diário persiste apenas na própria tabela; memorialização exige
  fluxo explícito do usuário fora desta fase (`limitations.md` itens 6 e 8).
- Isolamento: outro admin não lê nem escreve no diário alheio (`tests/learning.test.mjs:228-233`).

## 5. API

| Rota | Escopo | Corpo / Resposta |
|---|---|---|
| `POST /api/learn/:id/journal` | `learn:write` | `{kind, content}` → `{id, kind, content, created_at}` (`index.js:1496-1502`) |
| `GET /api/learn/:id/journal` | `learn:read` | array de entradas; 404 se cross-owner (`index.js:1503-1507`) |

Erros (mapa `learnError`, `index.js:1447-1462`): `learn_journal_kind_invalid`→400,
`learn_content_required`→400, `not_found`→404.

## 6. Testes

| Cenário | Teste |
|---|---|
| Entrada criada com kind válido; kind inválido rejeitado | `tests/learning.test.mjs:219-227` |
| Isolamento cross-owner (leitura e escrita) | `tests/learning.test.mjs:228-233` |
| E2E: journal via HTTP + progresso depois | `tests/research-security.test.mjs:243-252` |

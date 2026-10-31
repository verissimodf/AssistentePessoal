# Learning Engine — Fase 4

Implementação: `server/learning.js`. ADR-RS-004 (progresso de contagens). Esquema: migração v23,
tabelas `learn_*` (`migrations.js:1426-1493`).

## 1. Arquitetura (modelo de dados)

| Tabela | Papel | Campos-chave |
|---|---|---|
| `learn_projects` | jornada do operador | `goal` (≤1000), `level`, `sources_json` (≤20 ids do Hub), `research_project_id` (FK opcional, ON DELETE SET NULL), `status` (`draft`/`ready`/`archived`) — `migrations.js:1426-1438` |
| `learn_modules` | módulos ordenados | `title`, `description`, `order_index` — `migrations.js:1440-1448` |
| `learn_lessons` | lições por módulo | `title`, `content` (≤20.000 chars), `references_json`, `order_index` — `migrations.js:1450-1459` |
| `learn_activities` | exercícios | `type` (CHECK 6 tipos), `question`, `options_json`, `expected_answer`, `concept` — `migrations.js:1461-1471` |
| `learn_attempts` | tentativas do usuário | `answer` (≤5000), `feedback`, `correct` (INTEGER nullable: 1/0/NULL) — `migrations.js:1473-1483` |
| `learn_journal` | diário do usuário | `kind` (CHECK 5 kinds), `content` — `migrations.js:1485-1493` |

Ownership: `learn_project` registrado no `ownership` (`migrations.js:1499`); `assignNew`/`owns`/`dropOwnership`
em toda operação (`learning.js:62,72,287,322,337,377-380`).

## 2. Módulos do código (`learning.js`)

| Função | Linha | Papel |
|---|---|---|
| `createLearningProject` | `:40-66` | cria projeto `draft` |
| `getLearningProject` | `:71-94` | projeto + módulos + lições (com `references` e `activity_count`) |
| `listLearningProjects` | `:96-101` | lista do owner |
| `generateLearningPath` | `:104-169` | gera módulos/lições via one-shot → ver `learning-paths.md` |
| `tutorAsk` | `:181-208` | tutor contextual → ver `tutor.md` |
| `generateActivities` / `listActivities` / `submitAttempt` | `:221-315` | ver `assessments.md` |
| `addJournalEntry` / `listJournal` | `:321-341` | ver `learning-journal.md` |
| `learningProgress` | `:344-373` | contagens por lição |
| `deleteLearningProject` | `:375-383` | delete + drop de ownership, auditado |

## 3. Princípios implementados

| Princípio | Como |
|---|---|
| **Nada vira memória automática** | nenhuma função grava em memórias/procedurais; só tabelas `learn_*` + audit de metadados (`learning.js:64,167,202,252,305,330,381`); limitação declarada em `limitations.md` item 6 |
| **Progresso = contagens** | `learningProgress` retorna por lição: `activities`, `attempts`, `correct`, `incorrect`, `undetermined` — nenhum rótulo de "domínio" (`learning.js:343-373`) |
| **`correct` pode ser `null`** | veredicto do modelo mapeado 1/0/NULL; NULL = indeterminável, nunca chutado (`learning.js:294-300`); `undetermined` aparece no progresso (`learning.js:369`) |
| **Conteúdo de lição = dado não confiável** | marcado "DADO NÃO CONFIÁVEL" nos prompts de tutor/atividades/feedback (`learning.js:120,194,226,292`) |
| **Plano é geração única** | regenerar jornada → `learn_already_generated` (`learning.js:107`); sem edição manual nesta fase (`limitations.md` item 7) |
| **One-shot escopado** | principal de serviço `tokenId:"learning"`, `scopes:["kh:read"]` — sem escrita nem web (`learning.js:28-36,171-176`) |

## 4. Auditoria

Eventos `learn.*` só com metadados (ids/contagens/status): `learn.created`, `learn.plan_failed`,
`learn.planned`, `learn.tutor`, `learn.activities_generated`, `learn.attempt` (status
`correct`/`incorrect`/`undetermined`), `learn.journal_entry`, `learn.deleted`
(`learning.js:64,135,167,202,252,305-309,330,381`). Sem vazamento de conteúdo — testado
(`tests/research-security.test.mjs:258-266`).

## 5. Testes

`tests/learning.test.mjs`: jornada + ownership (`:108-126`), integração Hub (`:128-154`), tutor
(`:156-167`), atividades/tentativas/progresso (`:169-206`), diário + isolamento cross-owner (`:208-236`).
E2E HTTP: `tests/research-security.test.mjs:201-256`.

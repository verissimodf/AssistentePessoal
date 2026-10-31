# Relatórios Fundamentados — Fase 4

Implementação: `nodeResearchReport` em `server/research.js:528-597`. Tabela `research_reports`
(`migrations.js:1415-1424`). ADR-RS-003 (citações autoritativas).

## 1. Versionamento

- `version = MAX(version)+1` por projeto, com `UNIQUE(project_id, version)` (`research.js:573-575`; `migrations.js:1423`).
- Cada execução do pipeline (incl. `deepenResearch`) gera uma NOVA versão — nada é sobrescrito (`research.js:618-638`; testado `tests/research-engine.test.mjs:314-318`).

## 2. Conteúdo gerado (`research.js:553-572`)

Markdown com seções fixas:

| Seção | Conteúdo |
|---|---|
| Título | a pergunta do projeto |
| Cabeçalho | escopo, data e metodologia declarada ("decomposição em subperguntas + busca web/hub + extração de evidências verbatim + síntese") |
| `## Conclusões` | cada claim com status e marcação `[evidências registradas]` ou `[inferido sem evidência direta]` (`research.js:558-563`); sem claims → "Nenhuma afirmação sustentada pelas fontes." |
| `## Contradições` | descrição de cada conflito + `resolution` registrada (`research.js:565-568`) |
| `## Fontes` | citações numeradas `[n] (origin) título — url` geradas dos REGISTROS de fonte (`research.js:570-571`) |

## 3. Citações autoritativas (`citations_json`)

- Construídas dos registros de `research_sources` (id/origin/title/url/domain), **não do modelo** (`research.js:531-552`).
- Cada citação: `{n, source_id, origin, title, url|null, domain}` (`research.js:545-552`).
- Rastreabilidade completa: citação de relatório → `source_id` → `research_sources` → conteúdo + hash → evidências verbatim (`evidence-model.md` §3).

## 4. Endpoints

| Rota | Escopo | Comportamento |
|---|---|---|
| `GET /api/research/:id` | `research:read` | inclui lista resumida de relatórios (`id, version, title, created_at`) ordenada por versão desc (`research.js:121-125`; `index.js:1413-1417`) |
| `GET /api/research/:id/report` | `research:read` | relatório mais recente completo + `citations` parseadas; 404 se não houver relatório (`index.js:1436-1444`) |

O run completo (nós/eventos) continua disponível via `GET /api/workflow-runs/:id` — `executeResearch`
retorna apenas projeto (o estado do projeto já carrega o resultado; `research.js:220-222`).

## 5. Status final ligado ao relatório

Após gravar o relatório (`research.js:587-594`):

| Condição | `research_projects.status` |
|---|---|
| ≥1 evidência `direct` | `completed` |
| evidências, todas `indirect` | `partial` |
| nenhuma evidência | `inconclusive` (também setado direto na síntese sem evidência, `research.js:471-476`) |

Audit `research.report` com status e contagem de fontes (`research.js:595`) — só metadados
(`tests/research-security.test.mjs:258-266`).

## 6. Testes

| Cenário | Teste |
|---|---|
| Relatório com citações autoritativas de fonte web | `tests/research-engine.test.mjs:190-196` |
| Versões acumuladas por rodada de deepen | `tests/research-engine.test.mjs:314-318` |
| E2E via API: `report.content` e `citations[0].source_id/origin` | `tests/research-security.test.mjs:176-179` |
| Cross-owner no relatório → 404 | `tests/research-security.test.mjs:191-199` |

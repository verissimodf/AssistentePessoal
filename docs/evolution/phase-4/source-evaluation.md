# Avaliação de Fontes — Fase 4

O que o motor declara sobre a qualidade das fontes — e o que ele deliberadamente NÃO faz.

## 1. Qualidade de recuperação (`research_sources.quality`)

| Valor | Quando | Código |
|---|---|---|
| `snippet_only` | inserida a partir de resultado de busca/hub, página ainda não recuperada | default no INSERT (`research.js:362`) |
| `full` | texto plano recuperado, tamanho < 500 KB | `research-search.js:170` |
| `partial` | texto truncado no limite (500 KB / `JARVIS_RESEARCH_MAX_PAGE`) | `research-search.js:170` |
| `failed` | URL insegura, fetch falho, página vazia | `research-search.js:149,169,173` |

- Só `full`/`partial` com conteúdo entram na extração de evidências (`research.js:417-421`).
- Recuperação limitada a 12 fontes pendentes por invocação (`research.js:389-393`); conteúdo persistido truncado a 100 KB (`research.js:400`).
- Nó `retrieve` reporta contagem de falhas na saída (`research.js:408-411`).

## 2. Dedupe e canonicalização

- URL canônica: sem fragmento e sem `utm_*|fbclid|gclid|ref|source` (`research-search.js:13-19`); dedupe na resposta do provedor por `canonical_url` (`research-search.js:107-121`).
- Hash: SHA-256 do conteúdo (ou da URL se sem conteúdo) gravado como `content_hash` (`research.js:353-357`), com índice único parcial por projeto (`migrations.js:1381`).
- Duplicata no banco → `INSERT` falha e é ignorada, sem recriar a fonte (`research.js:379-381`); provado em `deepen` (`tests/research-engine.test.mjs:297-313`).
- Após recuperação, `canonical_url` é atualizada a partir da `final_url` do fetch (`research.js:403`).

## 3. Conflitos: declarados pela síntese, nunca resolvidos arbitrariamente

- Conflitos vêm SOMENTE do que a síntese declara no JSON `{"conflicts":[{"a","b","description"}]}`, persistidos com referência às claims (`research.js:477,510-521`).
- Não há detector semântico independente — limitação declarada (`limitations.md` item 3).
- `resolution` permanece sempre `'unresolved'`: nenhuma função grava `resolved_a`/`resolved_b`/`insufficient` (CHECK em `migrations.js:1411`; único uso em `research.js:540` é leitura para o relatório).
- No relatório, conflitos são listados com a resolução registrada (nada a resolver = `unresolved`) (`research.js:565-568`).

## 4. O que NÃO existe (sem invenção)

| Ausência deliberada | Justificativa |
|---|---|
| Scores numéricos de confiabilidade de fonte/domínio | mandato proíbe inventar métricas de qualidade (`limitations.md` item 11); só há contagens/estados de execução |
| Ranking próprio de resultados | ordem do provedor preservada, filtros apenas por domínio pedido (`research-search.js:106-122`) |
| Resolução automática de conflitos | decisão fica com o humano, via relatório versionado |
| Classificação de bias/credibilidade | não implementado; `metadata_json` guarda apenas proveniência técnica (`research.js:337,305`) |

## 5. Status do projeto como sinal honesto

- Provedor indisponível com nenhuma fonte web → audit `research.web_unavailable` e projeto termina `partial`/`inconclusive`, nunca `completed` (`research.js:341-346,587-594`; testado `tests/research-engine.test.mjs:245-265`).
- Síntese sem evidência nenhuma → `inconclusive` com motivo `no_evidence` (`research.js:471-476`).

# Pesquisa Híbrida — Fase 2

Implementação: `khSearch` em `server/knowledge.js:487-588`. Perna vetorial/lexical: `searchDocuments` em `server/documents.js:488-618`.

## Pernas de busca

| Perna | Motor | Detalhe |
|---|---|---|
| 1. Lexical FTS5 | `kh_fts MATCH` + `bm25(kh_fts)` + `snippet(kh_fts, 0, '«','»','…', 24)` | JOIN com `kh_chunk_index` para recuperar `document_id`/`source_id`; `LIMIT lim*3` (knowledge.js:518-524). MATCH inválido degrada silenciosamente para o pipeline RAG (knowledge.js:532-534) |
| 2. Vetorial+lexical | `searchDocuments` (pipeline existente, ownership-safe) | score = **0.7 semântico (cosine em JS sobre `embedding_json`) + 0.3 lexical (overlap de termos)** (documents.js:586); fallback gracioso para 100% lexical sem embedding (documents.js:588-592) |

## Escopo autorizado — aplicado ANTES do ranking

- Filtro SQL por `owner_admin_id` + notebook/biblioteca monta o mapa `scoped` de fontes permitidas **antes** de qualquer busca (knowledge.js:496-511).
- Hits de ambas as pernas fora do escopo são descartados (`scoped.get(...)` → `continue`, knowledge.js:528, 541) — a perna 2 busca no acervo todo do owner e o recorte KH é restringido depois, mas sempre no backend (nunca só na UI).
- Notebook/biblioteca alheios retornam vazio, mesmo conhecendo os ids (`tests/kh-core.test.mjs:146-162`, `tests/kh-security.test.mjs:89-98`).
- Só fontes `ingest_status IN ('indexed','partial')` com `document_id` participam (knowledge.js:508).

## Fusão (knowledge.js:545-579)

- Chave de junção: `document_id:chunk` (chunk do RAG ou `row_id` do FTS).
- Rank normalizado por perna: `ftsScore = bm25 / max(bm25)`; `ragScore = score` do `searchDocuments`.
- Score final: **`0.5 * ftsScore + 0.5 * ragScore`** (knowledge.js:563).
- Modo da citação: `hybrid_fts_rag` (nas duas), `fts5` (só FTS) ou `search_mode` do RAG (knowledge.js:574).

## Piso de relevância (knowledge.js:583)

`fts_score > 0 || rag_score >= 0.3` — ruído lexical fraco (overlap baixo, sem hit de FTS) não é retornado, evitando "achados" sem valor factual na resposta fundamentada.

## Dedupe e ordenação

- Mapas por chave `doc:chunk` eliminam duplicatas entre pernas (knowledge.js:529-530, 542).
- Ordenação por score final decrescente; `limit` clampado 1..50 (knowledge.js:512, 580, 585).

## Citação estruturada (por item — knowledge.js:568-577)

| Campo | Conteúdo |
|---|---|
| `source_id`, `source_title` | fonte KH |
| `document_id`, `chunk_id`, `chunk_index` | documento/chunk reais do pipeline (chunk_id pode ser `null` para hit só-FTS) |
| `mode` | `hybrid_fts_rag` \| `fts5` \| modo do RAG |
| `score` | score fundido no instante da resposta |
| `at` | timestamp (`now()`) — snapshot pontual |

## Limitação honesta (ADR-KH-001)

Sem extensão vetorial nativa (sqlite-vec): a perna semântica usa **cosine em JS** sobre os embeddings já existentes de `document_chunks` — O(N) por consulta no acervo do owner. Correta e testada; migração para extensão nativa fica condicionada a medição (`docs/evolution/phase-2/decisions.md` ADR-KH-001; `limitations.md` item 1). O design da Fase 0 (§05) já previa extensão vetorial embutida como alvo.

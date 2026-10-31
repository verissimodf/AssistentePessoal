# Notebooks, Bibliotecas e Relacionamentos — Fase 2

Implementação: `server/knowledge.js:49-213` (bibliotecas), `127-213` (notebooks), schema em `server/migrations.js:908-999`.

## Bibliotecas (`kh_libraries`)

| Aspecto | Regra | Referência |
|---|---|---|
| Tipos (`kind`) | `personal` \| `project` (com `project_ref` opcional, ≤200 chars) | knowledge.js:53, migrations.js:912 |
| Nome | obrigatório, ≤120 chars; UNIQUE por owner | knowledge.js:51-52; migrations.js:917 |
| Limite | — (notebooks é que são limitados por biblioteca) | — |
| CRUD | `createLibrary`/`listLibraries`/`getLibrary`/`updateLibrary`/`deleteLibrary` | knowledge.js:49-125 |
| Exclusão | remove documentos de todas as fontes via `deleteDocument`, relações e ownership | knowledge.js:106-125 |

## Notebooks (`kh_notebooks`)

| Aspecto | Regra | Referência |
|---|---|---|
| Hierarquia | sempre dentro de uma biblioteca (FK + ownership da biblioteca verificado) | knowledge.js:131 |
| Tags | array JSON, ≤20 tags de ≤60 chars | knowledge.js:141, 188-192 |
| Nome | UNIQUE por biblioteca | migrations.js:929 |
| Limite | `max_notebooks_per_library: 100` → `kh_notebook_limit` (409) | knowledge.js:134-135 |
| `source_count` | computado on-the-fly: fontes com `ingest_status != 'deleted'` | knowledge.js:171 |
| Exclusão | fontes → `deleteDocument`; relações e ownership removidos | knowledge.js:202-213 |

## Organização e escopo de pesquisa

- Pesquisa (`khSearch`) aceita escopo por `notebook_id` **ou** `library_id` (fontes de todos os notebooks da biblioteca) — resolvido em SQL no backend (knowledge.js:497-505).
- Sem filtro, o escopo é todo o acervo do owner (knowledge.js:496).
- Fontes (dedupe por hash **por notebook**, `idx_kh_sources_hash` parcial) pertencem a exatamente um notebook; `document_id` liga ao pipeline existente.
- Teste de isolamento: notebook/biblioteca alheios não funcionam como filtro (`tests/kh-core.test.mjs:156-161`).

## Relacionamentos (`kh_relationships`)

| Coluna | Valores |
|---|---|
| `from_type`/`to_type` | `source` \| `notebook` \| `library` \| `memory` \| `entity` \| `chunk` |
| `relation` | texto livre (sem CHECK) |
| `kind` | `explicit` \| `inferred` (DEFAULT `explicit`) |
| `confidence` | REAL nullable |
| `provenance` | JSON — cadeia de derivação |

- Índices nas duas pontas (`idx_kh_rel_from`, `idx_kh_rel_to`, migrations.js:998-999).
- Regra de honestidade epistêmica: **relação inferida nunca é fato** — `kind='inferred'` exige `confidence` e `provenance`; apenas `kind='explicit'` (criação humana/explícita) é afirmação direta. Deriva da regra central da Fase 0 §05: "hipótese ≠ fato".
- Constraints de `kind` e tipos de nó testadas em `tests/kh-migration.test.mjs:92-98`.
- Exclusões em cascata lógica: relações removidas quando biblioteca/notebook/fonte (qualquer ponta) é excluída (knowledge.js:118, 207, 472).

## Contrato reservado (não implementado nesta fase)

- **Extração automática de relacionamentos inferidos**: a tabela suporta `kind: 'inferred'` com `confidence`, mas não há extração automática de entidades/relações nesta fase — inferência de modelo virando grafo exigiria política de revisão (`limitations.md` item 7). Nenhum código insere em `kh_relationships` hoje (só remoção).

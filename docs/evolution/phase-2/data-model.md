# Modelo de Dados — Fase 2 (migration v21)

Fonte única: `server/migrations.js:898-1126` (`version: 21`). Todos os timestamps são `TEXT NOT NULL`.

## Tabelas

### `kh_libraries` (migrations.js:908-918)
| Coluna | Tipo | Constraint |
|---|---|---|
| `id` | TEXT | PRIMARY KEY |
| `owner_admin_id` | TEXT | NOT NULL REFERENCES admins(id) |
| `name` | TEXT | NOT NULL |
| `kind` | TEXT | NOT NULL DEFAULT 'personal' CHECK IN ('personal','project') |
| `project_ref` | TEXT | — |
| `description` | TEXT | NOT NULL DEFAULT '' |
| `created_at`/`updated_at` | TEXT | NOT NULL |

UNIQUE `(owner_admin_id, name)`.

### `kh_notebooks` (migrations.js:920-931)
`id` PK; `library_id` NOT NULL REFERENCES kh_libraries(id) **ON DELETE CASCADE**; `owner_admin_id` NOT NULL; `name` NOT NULL; `description` DEFAULT ''; `tags` TEXT DEFAULT '[]' (JSON); timestamps.
UNIQUE `(library_id, name)`. Índice `idx_kh_notebooks_library(library_id)` (migrations.js:931).

### `kh_sources` (migrations.js:933-955)
| Coluna | Tipo | Constraint |
|---|---|---|
| `id` | TEXT | PRIMARY KEY |
| `notebook_id` | TEXT | NOT NULL REFERENCES kh_notebooks(id) **ON DELETE CASCADE** |
| `owner_admin_id` | TEXT | NOT NULL REFERENCES admins(id) |
| `document_id` | TEXT | nullable — aponta para `documents` (pipeline existente) |
| `type` | TEXT | NOT NULL DEFAULT 'file' CHECK IN ('file','url','text') |
| `title` | TEXT | NOT NULL |
| `description` | TEXT | NOT NULL DEFAULT '' |
| `origin` | TEXT | NOT NULL DEFAULT '' |
| `content_hash` | TEXT | nullable — SHA-256 calculado no servidor |
| `size` | INTEGER | NOT NULL DEFAULT 0 |
| `mime` | TEXT | NOT NULL DEFAULT '' |
| `version` | INTEGER | NOT NULL DEFAULT 1 |
| `ingest_status` | TEXT | NOT NULL DEFAULT 'pending' CHECK IN ('pending','processing','indexed','partial','failed','deleted') |
| `index_status` | TEXT | NOT NULL DEFAULT 'pending' CHECK IN ('pending','indexed','partial','lexical_only') |
| `error_code` | TEXT | nullable |
| `provenance` | TEXT | NOT NULL DEFAULT '{}' (JSON: `created_by`, `created_via`) |

Índices: `idx_kh_sources_notebook(notebook_id)`, `idx_kh_sources_doc(document_id)`; **UNIQUE parcial** `idx_kh_sources_hash(notebook_id, content_hash) WHERE content_hash IS NOT NULL` (migrations.js:955) — dedupe por hash só vale dentro do notebook.

### `kh_source_content` (migrations.js:957-961)
`source_id` PRIMARY KEY REFERENCES kh_sources(id) **ON DELETE CASCADE**; `content` TEXT NOT NULL; `mime` DEFAULT 'text/plain'. Conteúdo bruto 1:1 com a fonte (textos inline/upload).

### `kh_source_versions` (migrations.js:963-973)
`id` PK; `source_id` NOT NULL REFERENCES kh_sources(id) **ON DELETE CASCADE**; `version` INTEGER NOT NULL; `document_id` TEXT NOT NULL; `content_hash` TEXT NOT NULL; `size` DEFAULT 0; `note` DEFAULT ''; `created_at`.
UNIQUE `(source_id, version)`.

### `kh_chunk_index` (migrations.js:975-981)
`id` INTEGER PRIMARY KEY **AUTOINCREMENT** (é o `rowid` do FTS); `source_id` NOT NULL REFERENCES kh_sources(id) **ON DELETE CASCADE**; `document_id` TEXT NOT NULL; `chunk_id` TEXT NOT NULL **UNIQUE**. Índice `idx_kh_chunk_index_doc(document_id)`.

### `kh_fts` — tabela virtual FTS5 (migrations.js:983)
`USING fts5(text, title)` — colunas indexadas: texto do chunk e título do documento. `rowid` controlado por `kh_chunk_index` para remoção determinística (migrations.js:902).

### `kh_relationships` (migrations.js:985-999)
| Coluna | Constraint |
|---|---|
| `id` | PK |
| `owner_admin_id` | NOT NULL REFERENCES admins(id) |
| `from_type` / `to_type` | CHECK IN ('source','notebook','library','memory','entity','chunk') |
| `from_id` / `to_id` | NOT NULL |
| `relation` | NOT NULL |
| `kind` | NOT NULL DEFAULT 'explicit' CHECK IN ('explicit','inferred') |
| `confidence` | REAL (nullable) |
| `provenance` | NOT NULL DEFAULT '{}' |

Índices: `idx_kh_rel_from(from_type, from_id)`, `idx_kh_rel_to(to_type, to_id)`.

### `kh_transformations` (migrations.js:1001-1012)
`id` PK; `owner_admin_id` NOT NULL; `op` CHECK IN ('summary','topics','concepts','compare','synthesize'); `source_ids` JSON; `params` JSON; `result` TEXT; `citations` JSON; `executor` TEXT; `created_at`. Índice `idx_kh_transformations_owner(owner_admin_id, created_at)`.

### `kh_jobs` (migrations.js:1014-1026)
`id` PK; `idempotency_key` TEXT NOT NULL **UNIQUE**; `source_id` NOT NULL REFERENCES kh_sources(id) **ON DELETE CASCADE**; `status` DEFAULT 'pending' CHECK IN ('pending','running','succeeded','failed'); `attempts` INTEGER DEFAULT 0; `lease_until` TEXT nullable; `checkpoint_json` DEFAULT '{}'; `last_error`; timestamps. Índice `idx_kh_jobs_claim(status, created_at)`.

## Ownership

Tipos `kh_library`, `kh_notebook`, `kh_source` registrados no CHECK da tabela `ownership` recriada na v21 (migrations.js:1032); trigger `trg_ownership_immutable` preservado (migrations.js:1042). Linhas existentes são copiadas intactas na recriação (migrations.js:1039; testado em `tests/kh-migration.test.mjs:61-73`). Registros criados via `assignNew("kh_*", ...)` (`server/knowledge.js:60,142,416`); exclusões via `dropOwnership` (`server/knowledge.js:121,209,474`).

## Integridade referencial e ciclo de vida

- Cascades: notebook→biblioteca, fonte→notebook, conteúdo/versões/chunk-index/jobs→fonte (tabela acima).
- Exclusão lógica da fonte: `ingest_status='deleted'`, `document_id=NULL` + remoção explícita de FTS/relações (`server/knowledge.js:471-475`).
- Ciclo de versões: criação grava versão 1 com nota 'criação' (`server/knowledge.js:420-422`); nova ingestão com `document_id` atualiza `kh_source_versions.document_id` da versão corrente (`server/knowledge.js:304-308`). Re-upload com versão+1 não está exposto na API desta fase (`limitations.md` item 6).

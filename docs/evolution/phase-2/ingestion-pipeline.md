# Pipeline de Ingestão — Fase 2

Fontes: `server/knowledge.js` (criação/ingestão/exclusão), `server/kh-fetch.js`, `server/index.js:1111-1161`, `server/documents.js:370-456`.

## 1. Criação da fonte — `createSource` (knowledge.js:351-427)

1. Ownership do notebook verificado no backend (`owns`, knowledge.js:353).
2. **Dedupe por hash calculado no SERVIDOR**: SHA-256 do buffer real — nunca hash do cliente (knowledge.js:377-383; teste `tests/kh-core.test.mjs:78-88`). Duplicata retorna `{ duplicate: true }` sem criar linha; na API vira **409 `kh_duplicate`** (index.js:1126,1139).
3. **Limites cedo** (antes de persistir qualquer coisa, knowledge.js:384-389):
   - `max_sources_per_notebook: 200` → erro `kh_source_limit` (409);
   - texto: 2 MB (`max_text_bytes`); binário pdf/docx: 10 MB → `kh_too_large` (413).
4. Transação única (knowledge.js:392-423): INSERT em `kh_sources` (status inicial `pending`/`pending`) + `kh_source_content` (buffer bruto) + `assignNew("kh_source")` + **`kh_jobs`** com `idempotency_key = "kh:<sourceId>:v1"` (UNIQUE) + **`kh_source_versions`** versão 1 (nota 'criação').
5. `processIngest` é invocado em seguida, no mesmo fluxo (knowledge.js:425).

Tipos de fonte: `text` (conteúdo inline, obrigatório), `file` (buffer do upload via multipart ou JSON base64, index.js:1111-1145), `url` (validação `/^https?:\/\//i` → senão `kh_url_invalid` 400, knowledge.js:363-365).

## 2. Fila durável — `kh_jobs`

| Mecanismo | Implementação |
|---|---|
| Idempotência | `idempotency_key` UNIQUE por fonte+versão (migrations.js:1016; knowledge.js:418-419) |
| Lease | worker marca `status='running'`, `lease_until = now + 120s`, `attempts++` (knowledge.js:260-264); retomada só quando o lease expira (knowledge.js:259) |
| Checkpoint | `checkpoint_json` registra estágios: `extracting → downloading → saving_document → fts_indexing` (knowledge.js:268-310) |
| Retry | falha: `status = attempts >= 3 ? 'failed' : 'pending'`, `last_error` gravado, lease limpo (knowledge.js:333) |
| Concorrência | `max_jobs_concurrent: 1` — ingestão single-thread in-process (knowledge.js:26) |

## 3. Processamento — `processIngest` (knowledge.js:253-337)

1. Sem `document_id`: extrai buffer (URL via `safeFetchUrl` ou `kh_source_content`), chama **`saveDocument`** do pipeline existente — que valida, escreve arquivo 0600, chunkifica, gera embeddings e cria `document_chunks` (documents.js:370-456).
2. `rag_status` do documento define `index_status` da fonte: sem embedding → `lexical_only`, com → `indexed` (knowledge.js:298-303). Sem provedor de embeddings a fonte fica **`partial`** — pesquisável via FTS/lexical (`limitations.md` item 4).
3. **FTS**: `indexSourceFts` apaga indexação anterior do documento (reingestão), insere uma linha em `kh_chunk_index` por chunk e usa seu `lastInsertRowid` como `rowid` de `kh_fts` (knowledge.js:225-250). Zero chunks → falha `kh_index_empty`.
4. Estados finais da fonte: `indexed` / `partial` (sucesso), `failed` + `error_code` (falha), job → `succeeded`. Auditoria `kh.ingested` / `kh.reindexed` / `kh.ingest_failed` (só metadados — `tests/kh-security.test.mjs:143-151`).

## 4. Recuperação no boot — `recoverKhJobs` (knowledge.js:340-349)

- Jobs `running`/`pending` sem lease válido voltam a `pending` (UPDATE conservador) + auditoria `kh.jobs_recovered`.
- Pendentes reprocessados em background na ordem de criação.
- Chamado no boot do serviço (index.js:1696). Teste de idempotência: fonte órfã em `processing` volta a `indexed` sem duplicar chunks/FTS (`tests/kh-core.test.mjs:126-144`).

## 5. Exclusão consistente — `deleteKhSource` (knowledge.js:460-478)

1. Ownership verificado; invisível para não-dono (404).
2. Para **cada** `document_id` em `kh_source_versions` (todas as versões): `deleteDocument` — remove documento, chunks e ownership (documents.js:620-637).
3. Remove linhas de `kh_fts` (por rowid) e `kh_chunk_index` da fonte.
4. Transação: delete de `kh_relationships` (ambas as pontas), `ingest_status='deleted'`, `document_id=NULL`, `dropOwnership`.
5. Auditoria `kh.source_deleted`. Sem órfãos — verificado em `tests/kh-core.test.mjs:90-105`. Biblioteca/notebook excluídos propagam para as fontes antes (knowledge.js:106-125, 202-213).

## 6. Fontes URL — `safeFetchUrl` (kh-fetch.js:9-19)

| Passo | Garantia |
|---|---|
| `assertSafeUrl` + `assertPublicHost` | bloqueia esquemas não-HTTP, redes privadas e metadados de cloud (SSRF) — mesma política do `fetchUrl` do chat |
| `safeFetch` | timeout de 30 s; resposta `!ok` → erro `kh_fetch_failed` (**502**) |
| Mime | aceita apenas `text/*`, `application/json|xml|xhtml` → senão `kh_unsupported_mime` (**415**); o mime do parser do pipeline não inclui HTML → ingestão falha com `unsupported_type` (415, `tests/kh-core.test.mjs:107-115`; ADR-KH-006) |
| Tamanho | buffer > `KH_MAX_URL_BYTES` (2 MB, env `JARVIS_KH_MAX_URL_BYTES`) → `kh_too_large` (**413**) |

Teste E2E de SSRF: alvos internos (169.254.169.254, 127.0.0.1, `file://`) são recusados na criação (400) ou falham na ingestão sem serem indexados (`tests/kh-security.test.mjs:109-125`).

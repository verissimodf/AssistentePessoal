# Operações — Knowledge Hub (Fase 2)

## 1. Uso

1. Painel → **Knowledge Hub** → criar biblioteca ("Pessoal" ou "Projeto") → criar notebook.
2. Adicionar fontes: texto colado, URL pública (http/https; só texto) ou upload de arquivo
   (txt/md/csv/json/pdf/docx — mesmos limites do pipeline: 2 MB texto, 10 MB binário).
3. A ingestão é **assíncrona e durável** (`kh_jobs`): a fonte passa por
   `pending → processing → indexed | partial | failed`.
   - `partial`/`lexical_only`: embeddings indisponíveis no momento — a fonte é pesquisável via
     FTS5/lexical; reprocessar com `POST /api/kh/sources/:id/ingest` (ou reindexação do
     documento) quando o provedor de embeddings voltar.
   - `failed`: `error_code` explica (`unsupported_type`, `kh_content_missing`, `kh_fetch_failed`…).
4. Pesquisar (notebook atual ou biblioteca inteira); resultados mostram fonte, trecho, score e
   citação (documento/chunk). Perguntar ao acervo responde com citações e avisa quando as
   fontes são insuficientes.
5. Transformações (summary/topics/concepts/compare/synthesize) sobre fontes selecionadas —
   registradas em `kh_transformations` com fontes/versões/citações/executor.

## 2. Agente (chat e Workforce)

- No **chat normal**, a ferramenta `notebook_search` (escopo `kh:read`) responde do acervo com
  citações persistidas em `meta.citations` — este é o caminho com histórico de conversa.
- Na **Workforce**, especialistas com `kh:read`/`kh:write` nas `permission_scopes` pesquisam o
  acervo, fazem transformações fundamentadas e criam notas — contando como tool calls do run
  (orçamento da Fase 1). Bots legados nunca recebem escopos `kh:*`.

## 3. Diagnóstico e recuperação

| Situação | Onde olhar | Ação |
|---|---|---|
| Fonte presa em `processing` | `kh_jobs` (status/lease/`checkpoint_json`) | o boot recupera automaticamente (`recoverKhJobs`); para forçar: `POST /api/kh/sources/:id/ingest` |
| Falha de ingestão recorrente | `error_code` da fonte + `kh_jobs.last_error` | corrigir formato/tamanho/URL e reingestar |
| Acervo não aparece na pesquisa | `ingest_status`/`index_status` da fonte | só fontes `indexed`/`partial` entram na pesquisa (por design) |
| Embeddings ausentes (tudo `partial`) | provedor de embeddings (Diagnósticos) | reindexar quando o provedor voltar |
| Migração v21 falha no boot | `docs/RECUPERACAO.md` (backup verificado é pré-requisito) | restaurar e reabrir; migração atômica |
| Exclusão deixou lixo? | não deve — exclusão remove documento+chunks+FTS+relações (testado) | se suspeitar: `kh_chunk_index` vs `document_chunks` devem bater por fonte |

## 4. Backup

Nada novo: o conteúdo das fontes vive no pipeline de documentos existente (`data/` — banco +
arquivos) e as estruturas kh_* no `jarvis.db`. O mesmo backup de sempre
(banco + `master.key` + `data/`) cobre o Hub — ver `docs/RECUPERACAO.md`.

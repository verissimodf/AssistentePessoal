# Matriz de Rastreabilidade — Fase 2

Critérios de aceite (mandato §10) → implementação → testes.

| Critério | Implementação | Testes |
|---|---|---|
| Bibliotecas e notebooks persistentes | `kh_libraries`/`kh_notebooks` (v21) + CRUD (`server/knowledge.js`) | `kh-migration`, `kh-core` |
| Catálogo de fontes com ownership | `kh_sources` + `owns()` + ownership types | `kh-core`, `kh-security` |
| Ingestão dos formatos suportados | `createSource` → `saveDocument` (txt/md/csv/json/pdf/docx) | `kh-core` (inválido/limite) |
| Pipeline durável e recuperável | `kh_jobs` (lease/attempts/checkpoint) + `recoverKhJobs` no boot | `kh-core` (recuperação idempotente) |
| Pesquisa textual (FTS5) | `kh_fts` + `kh_chunk_index` (BM25/snippet) | `kh-migration` (FTS operante), `kh-core` |
| Pesquisa vetorial (quando suportada) | embeddings existentes via `searchDocuments` (cosine JS) | `kh-core` (embeddings sintéticos) |
| Recuperação híbrida | fusão 0.5/0.5 + piso de relevância | `kh-core`, debug de ruído lexical |
| Resultados filtrados por autorização | escopo no SQL antes do ranking | `kh-core`, `kh-security` (cross-owner/notebook/biblioteca) |
| Respostas fundamentadas com referências | `khAsk` + citações autoritativas | `kh-workforce`, `kh-security` (insuficiência) |
| Proveniência preservada | `provenance`/`content_hash`/`kh_source_versions`/`kh_transformations` | `kh-workforce` |
| Integração com memória existente | sem memória automática; escrita explícita via `kh:write`/remember | `kh-workforce` (nota hostil não eleva nada) |
| Ferramentas do Workforce operacionais | 3 tools no `callTool` + TOOL_META | `kh-workforce` |
| Proteção contra prompt injection documental | marcação untrusted + nada executável + D9 intacto | `kh-security`, `kh-workforce` |
| Exclusão/atualização consistentes | exclusão cascata sem órfãos (doc+chunks+FTS+relações) | `kh-core`, `kh-security` |
| Interface funcional | `src/routes/knowledge.tsx` (5 seções) | `knowledge-ui.test` (116/116 suíte) |
| Internacionalização | chaves `kh_*` pt/en/es (`src/lib/i18n.tsx`) | build + testes |
| Testes de segurança e regressão aprovados | backend 742/742 · frontend 116/116 · eval 6/6 | [`testing.md`](testing.md) |
| Documentação completa | 16 documentos + ADRs-KH-001..006 | links verificados |
| Commit local revisado | diff revisado, sem segredos, sem integrações tocadas | relatório executivo |
| Working tree limpa | pós-commit | confirmado |

Itens NÃO concluídos (documentados, não reduzidos): HTML/XLSX/áudio-vídeo sem parser; extensão
vetorial nativa adiada (ADR-KH-001); re-upload/versionamento via API e extração automática de
relacionamentos adiados — ver [`limitations.md`](limitations.md).

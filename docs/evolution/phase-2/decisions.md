# Decisões Técnicas — Fase 2

ADRs das decisões tomadas nesta fase (além dos ADRs-EVO-001..010 da Fase 0, que continuam válidos).

## ADR-KH-001 — FTS5 nativo + cosine JS mantido; extensão vetorial nativa adiada

**Status:** ACCEPTED · **Contexto:** ADR-EVO-006 preferia "FTS5 + sqlite-vec ou equivalente".
`node:sqlite` expõe FTS5 (verificado) e `loadExtension`, mas a extensão vetorial exigiria uma
nova dependência nativa de plataforma (sqlite-vec) sem ganho medido no acervo pessoal.
**Decisão:** FTS5 (BM25 + snippet) para a perna lexical; perna vetorial/lexical continua no
pipeline existente (`searchDocuments`, cosine em JS, ownership-safe). **Consequências:** zero
dependência nova; o piso de relevância compensa o ruído lexical; migração para extensão nativa
fica condicionada a medição (mesmo critério de saída do ADR-EVO-006).

## ADR-KH-002 — Fontes do Hub reutilizam o pipeline de documentos

**Status:** ACCEPTED · **Contexto:** criar armazenamento/chunks/embeddings próprios do Hub
duplicaria o pipeline testado. **Decisão:** `kh_sources.document_id` aponta para o documento
existente (`saveDocument`/`searchDocuments`/`deleteDocument`/`reindexDocument` reutilizados);
o Hub adiciona organização, versionamento, FTS, jobs e proveniência. **Consequências:** busca,
citações e avaliação existentes funcionam de graça; exclusão precisa remover kh_fts+relações
(implementado e testado).

## ADR-KH-003 — Jobs de ingestão próprios (kh_jobs) em vez de durable_jobs de bots

**Status:** ACCEPTED · **Contexto:** `durable_jobs` é acoplado a bots (`bot_id NOT NULL`,
trigger CHECK 'daily/interval/file'); reabrir esse contrato para jobs de outra natureza
arriscaria o scheduler em produção. **Decisão:** `kh_jobs` replica o padrão (idempotência
UNIQUE, lease, attempts, recovery no boot) para ingestão. **Consequências:** padrão duplicado
em tabela nova (~30 linhas SQL) — menor risco que alterar a fila de bots; unificação futura
avaliada na Fase 3 (motor de workflows).

## ADR-KH-004 — Citações autoritativas no modo fundamentado

**Status:** ACCEPTED · **Contexto:** o modelo pode "citar" fontes inexistentes. **Decisão:** em
`khAsk`, as citações retornadas são EXATAMENTE as dos trechos injetados no prompt (lista
autoritativa do backend); em chat normal, `meta.citations` continua registrando só buscas reais.
**Consequências:** impossível citar fonte não recuperada no modo fundamentado; a resposta do
modelo ainda pode citar MAL o conteúdo — mitigado pela regra de prompt + revisão humana.

## ADR-KH-005 — Escopos kh:read/kh:write próprios

**Status:** ACCEPTED · **Contexto:** reutilizar documents:read/write acoplaria a organização do
Hub à API de documentos soltos e impediria dar acesso ao acervo sem dar acesso à gestão de
documentos. **Decisão:** escopos novos aditivos; bots legados NÃO os recebem (fora de
BOT_SCOPES); especialistas da Workforce os obtêm por definição (interseção). **Consequências:**
least privilege mantido; auditoria por escopo explícita.

## ADR-KH-006 — Formatos HTML/XLSX sem suporte (sem parser fantasma)

**Status:** ACCEPTED · **Contexto:** mandato proíbe suporte fictício. **Decisão:** aceitos os
formatos com parser operacional (txt/md/csv/json/pdf/docx); HTML/XLSX falham com
`unsupported_type` (415) e ficam documentados como limitação (não como item "concluído").

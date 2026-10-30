# Integração com Memória — Fase 2

Base conceitual: `docs/evolution/phase-0/05-KNOWLEDGE-AND-MEMORY-ARCHITECTURE.md` (três domínios) e `06-SECURITY-THREAT-MODEL.md`. Implementação: `server/knowledge.js`, `server/tools.js`.

## Regra central

**Ingestão NUNCA cria memória automática.** Nenhuma etapa do pipeline de ingestão (`createSource` → `processIngest` → FTS) escreve na tabela `memories` — a ingestão cria apenas `kh_sources`, `documents`/`document_chunks`, `kh_chunk_index`/`kh_fts`, `kh_jobs` e `kh_source_versions` (`server/knowledge.js:392-423, 253-337`). Isso herda a política da Fase 0 §05 §4: "Sem memória automática permanente por saída de modelo — captura é opt-in".

## Os três domínios (Fase 0 §05 §1) e o papel do Hub

| Domínio | O que o Hub contribute | O que NÃO muda |
|---|---|---|
| Episódica | O Hub não cria episódios; pesquisas no chat normal ficam nas conversas existentes com `meta.citations` | Conversas v7-8 continuam a única fonte episódica |
| Semântica | Notebooks/notas do Hub organizam **fontes** que sustentam fatos; relações em `kh_relationships` (kind explicit/inferred + proveniência) | Fatos confirmados vivem em `memories`; `kh_relationships` não é camada semântica paralela |
| Procedural | Sem contribuição nesta fase | Receitas só de execuções com verificador nomeado |

## Nota = escrita explícita (kh:write)

- `createNote` cria uma **fonte do tipo `text`** com proveniência de nota — nunca é disparada pela ingestão ou por saída de modelo sem ação explícita (`server/knowledge.js:640-650`).
- No chat/workforce, a criação passa pela tool `notebook_note`, documentada como "ação de escrita explícita (escopo kh:write); nunca automática" (`server/tools.js:163-167`) e com portão `kh:write` (`server/auth.js:96`).
- Sem o escopo, o `callTool` nega em tempo de execução (`tests/kh-workforce.test.mjs:110-126`).

## Proveniência e kind fact/hypothesis

- Toda fonte carrega `provenance` JSON (`created_by`, `created_via`) e `kh_source_versions` preserva a cadeia de versões/documentos (`server/knowledge.js:409, 420-422`).
- Relações carregam `kind: 'explicit'|'inferred'`, `confidence` e `provenance` (`server/migrations.js:993-995`) — inferido nunca é fato (`notebooks.md`).
- Transformações (`khTransform`) registram resultado com citações versionadas em `kh_transformations` — são **derivações**, não fatos; viram memória só por escrita explícita subsequente (`server/knowledge.js:633-637`; `diagnostics.js:277`: "Transformações não criam memória permanente sem escrita explícita").
- Alinhamento com o contrato da Fase 0 §05 §2: `origin` humana/agent/ingestion/inference, `source_reference` = citação estruturada (source_id/document_id/chunk), validação é ato explícito.

## Como promover conteúdo a memória existente

1. O caminho implementado é a ferramenta **`remember`** existente (escopo `memories:write`, `server/auth.js:60`; `server/tools.js:871`): o operador/agente lembra o fato **citando a fonte** (ex.: `[fonte, chunk N]` da pesquisa `notebook_search`).
2. Não há botão "promover trecho a memória" na UI do Hub nesta fase (`limitations.md` item 8) — promoção é ato deliberado via `remember`, mantendo o padrão opt-in.
3. A citação estruturada do Hub (source_id/document_id/chunk/mode/score/at) serve de `source_reference` do contrato de memória da Fase 0 §05 §2.

## Sem segunda camada de memória conflitante

- O Hub organiza **FONTES** (bibliotecas/notebooks/fontes/chunks indexados); memórias continuam exclusivamente na tabela `memories` com embeddings próprios e quarentena v17 (`memory-retention.js`).
- Nenhuma leitura de memória passa pelo Hub; nenhuma pesquisa do Hub consulta `memories` — `khSearch` só varre `kh_sources`/`documents` (`server/knowledge.js:487-588`).
- Dedupe de escrita: nota com mesmo conteúdo (hash) no mesmo notebook é recusada — evita duplicar fontes, não memórias (`tests/kh-workforce.test.mjs` via `createNote` → `createSource` dedupe).
- Não há sincronização automática Hub→memórias nem memórias→Hub; a única ponte é a citação textual passada ao `remember`.

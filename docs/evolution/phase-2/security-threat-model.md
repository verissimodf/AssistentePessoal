# Security & Threat Model — Knowledge Hub (Fase 2)

Ameaças específicas do Hub sobre o modelo geral (`docs/evolution/phase-0/06-SECURITY-THREAT-MODEL.md`).
Cada ameaça: caminho, controles implementados (com referência) e risco residual.

## Ameaças e controles

| # | Ameaça | Controles implementados | Residual |
|---|--------|-------------------------|----------|
| KH-1 | **Prompt injection documental** (fonte instrui o agente) | Conteúdo sempre marcado DADO NÃO CONFIÁVEL (`server/tools.js` cases notebook_*; prompts do `khAsk`/`khTransform` com regra explícita, `server/knowledge.js`); ferramentas nunca executam nada do conteúdo; D9 intacto para efeitos externos | Baixo-médio — modelo pode "obedecer" texto, mas toda ação externa continua sob aprovação humana |
| KH-2 | **Vazamento entre owners** | `khSearch` filtra fontes do owner ANTES do ranking (`knowledge.js` — escopo aplicado no SQL, não na UI); `getKhSource`/`getNotebook`/`getLibrary` via `owns()`; 404 uniforme | Baixo — testado cross-owner (`tests/kh-core`, `tests/kh-security`) |
| KH-3 | **Vazamento entre projetos/bibliotecas** | Filtro notebook/library no backend antes do ranking; notebook alheio → resultado vazio | Baixo — testado |
| KH-4 | **Arquivo gigante/zip-bomb-like** | Limites cedo em `createSource` (2 MB texto / 10 MB binário — mesmos tetos do pipeline) → 413 `kh_too_large`; `MAX_BYTES` do urlpolicy para downloads | Baixo |
| KH-5 | **MIME spoofing / parser fantasma** | `validateDocument` do pipeline (magic bytes, allowlist); HTML/XLSX NÃO suportados → falha explícita `unsupported_type` (sem suporte fictício); URL só text/* etc. | Baixo |
| KH-6 | **Path traversal / nome hostil** | Nome tratado como título (string sanitizada), caminho de arquivo gerado pelo backend (`dirFor(ownerId)+uid.ext`, `documents.js`); nenhum caminho vindo do cliente é usado | Baixo |
| KH-7 | **SSRF via fonte URL** | `assertSafeUrl` + `assertPublicHost` + `safeFetch` (urlpolicy: bloqueio de loopback/privadas/metadata, DNS duplo) — nenhuma via nova de rede (`server/kh-fetch.js`); testado com 169.254.169.254/127.0.0.1/file:// | Baixo |
| KH-8 | **Corrupção de índice / referência obsoleta** | FTS com rowid controlado (`kh_chunk_index`); reindexação remove antes de inserir; exclusão remove documento+chunks+FTS+relações (sem órfãos — testado); falha de indexação → fonte `failed` (nunca acessível como indexada) | Baixo |
| KH-9 | **Reexecução de jobs** | `kh_jobs` com idempotency_key UNIQUE + lease + attempts; recuperação no boot reprocesa idempotentemente (dedupe por hash impede duplicação) | Baixo |
| KH-10 | **Excesso de ingestão** | Limites estruturais (`max_sources_per_notebook`, `max_notebooks_per_library`), dedupe por hash, ingestão single-thread | Baixo |
| KH-11 | **Vazamento em logs** | Audit `kh.*` apenas metadados (allowlist `AUDIT_FIELDS`); testado: nenhum conteúdo de fonte no audit | Baixo |
| KH-12 | **Acesso por agente delegado** | Ferramentas KH exigem escopo `kh:read`/`kh:write` no conjunto EFETIVO calculado pela Workforce; bots legados nunca recebem (fora de `BOT_SCOPES`); `callTool` revalida na execução | Baixo — testado |
| KH-13 | **Transformação como escalação** | `khTransform` roda one-shot com principal `service` escopado a `kh:read` criado pelo backend; sem loop de ferramentas; transformação registrada com proveniência | Baixo |
| KH-14 | **Nota como instrução privilegiada** | Nota é fonte tipo texto (dado); não altera políticas/instruções/escopos; teste com conteúdo "IGNORE INSTRUÇÕES…" verifica que nada muda | Baixo |

## Invariantes específicas do Hub

1. Toda leitura/pesquisa resolve o escopo autorizado **no backend**, antes do ranking.
2. Conteúdo de fonte é dado, nunca instrução nem autorização (mesmo em citação).
3. Nada vira memória permanente sem escrita explícita (`kh:write` via nota/remember).
4. Falha de indexação nunca resulta em acesso: fonte não indexada não entra em `khSearch`.
5. Hash de integridade é calculado no servidor (hash do cliente nunca é confiado).
6. Erros não expõem conteúdo nem caminhos (`khError` codes fechados).

## Riscos aceitos

- **Modelo pode citar mal apesar das regras** (KH-1): mitigação estrutural é a citação
  autoritativa (`khAsk` retorna as citações dos trechos injetados, não as do modelo); em chat
  livre, `meta.citations` só registra buscas reais de `document_search`/`notebook_search`.
- **Sem embeddings no ambiente de teste** → estados `partial`/`lexical_only` são válidos e
  pesquisáveis via FTS5/lexical (não é falha de segurança; é degradação honesta).

# Testes e Validação — Fase 2

Resultados reais executados em 2026-10-30 na branch
`evolution/phase-2-personal-knowledge-hub-20261030`.

## 1. Suítes novas (Knowledge Hub)

| Arquivo | Testes | Cobertura |
|---|---|---|
| `tests/kh-migration.test.mjs` | 6 | v21 do zero (todas as tabelas + FTS5 operante); backup íntegro no schema anterior; idempotência; upgrade v20→v21 preservando ownership; CHECKs (kind, ingest_status, relacionamentos, ownership); FKs; UNIQUEs (owner+name, library+name, hash por notebook) |
| `tests/kh-core.test.mjs` | 7 | CRUD de bibliotecas/notebooks com ownership e limites; ingestão de texto indexando chunks + FTS; dedupe por hash (mesmo notebook) com hash calculado no servidor; exclusão sem órfãos (documento, chunks, FTS, relacionamentos); arquivo inválido → `failed`/`unsupported_type`; limite → `kh_too_large` sem órfãos; recuperação de job órfão reprocessando idempotentemente; isolamento cross-owner na leitura e na pesquisa (notebook/biblioteca alheios → vazio) |
| `tests/kh-workforce.test.mjs` | 7 | `khAsk` com citações autoritativas (citação inventada pelo modelo não aparece) e insuficiência declarada; `khTransform` registrando fontes/versões/citações/executor, recusas (op inválida, sem fontes, fonte alheia); ferramentas `notebook_search`/`notebook_note`/`notebook_transform` via `callTool` (escopo exigido, negação sem escopo, injeção em nota não eleva nada); integração Workforce: especialista com `kh:read` pesquisa no acervo dentro do run |
| `tests/kh-security.test.mjs` | 9 | E2E HTTP real: 401 sem sessão; CSRF 403; injeção documental armazenada como dado (nada muda de permissão); isolamento 404 cross-owner (get/delete/search/notebook filter); dedupe na API (409 `kh_duplicate`); SSRF (169.254.169.254, 127.0.0.1, file://) recusados ou falha fechada; `khAsk` sem fontes declara insuficiência; exclusão remove do acervo para o dono; audit do Hub sem conteúdo (só metadados) |

Total: **29 testes novos** backend + **3 novos** frontend (`src/test/knowledge-ui.test.tsx`: helper
de badge para os 6 estados de ingestão + render da página com bridge mockada).

## 2. Regressão completa

| Checagem | Comando | Resultado |
|---|---|---|
| Backend completo | `node --no-warnings --test tests/*.test.mjs` | **742/742 pass, 0 fail** (713 da Fase 1 + 29) |
| Frontend completo | `npx vitest run` | **116/116 pass** (113 da Fase 1 + 3) |
| Avaliação agêntica | `npm run eval:agents` | 6/6 exit 0 |
| TypeScript | `npx tsc --noEmit` | exit 0 |
| Lint | `npx eslint .` | limpo (0 erros, 0 avisos) |
| Build de produção | `npm run build` | exit 0 |
| Config Docker | `docker compose config -q` | OK |
| Imagem + verificador | `docker build` (tag de verificação) + `scripts/verificar-imagem-release.sh` | **APROVADA** (container descartável; produção intocada) |
| Links da documentação | varredura de links relativos (`docs/evolution/**`, índices, README) | 0 quebrados |

## 3. Ajustes em testes pré-existentes (não enfraquecimento)

- `tests/diagnostics.test.mjs`: contagem de ferramentas 22 → **25** (`notebook_search`,
  `notebook_transform`, `notebook_note`) — o teste exige cobertura EXATA entre `TOOL_META` e
  `TOOL_DEFS`; entradas novas documentam portão/limites/testes das ferramentas do Hub.

## 4. Categorias obrigatórias (mandato §8) × realizado

| Categoria | Onde |
|---|---|
| Persistência e migração | `kh-migration`, `kh-core` |
| Ingestão (válido/inválido/limite/duplicata/falha/recuperação/idempotência/hash) | `kh-core` |
| Pesquisa (FTS5, vetorial com embeddings sintéticos, híbrida, filtros, dedupe via piso, isolamento owner/projeto) | `kh-core`, `kh-workforce` |
| Respostas fundamentadas (citação correta, evidência inexistente, inferência vs. fato via sufficient, versão correta) | `kh-workforce`, `kh-security` |
| Segurança (injeção documental, MIME spoofing, cross-owner, SSRF, nota hostil, exclusão sem autorização, logs, agentes delegados) | `kh-security`, `kh-workforce` |
| Integração (Workforce + orçamento + API + UI + i18n) | `kh-workforce`, `knowledge-ui.test` |
| Regressão | suíte completa 742 + 116 (Fases 0 e 1 preservadas) |

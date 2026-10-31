# Provedor de Busca Web — Fase 4

Implementação: `server/research-search.js`. ADR-RS-001 (`decisions.md`).

## 1. Interface `webSearchStructured`

Request (`research-search.js:84-87`):

| Campo | Tipo | Comportamento |
|---|---|---|
| `query` | string | obrigatório; vazio → `{provider:null, results:[], unavailable:"empty_query"}` |
| `limit` | number | default 8, clamped 1..20 (`research-search.js:87`) |
| `domains` | string[] | allowlist por sufixo de hostname (`research-search.js:116`) |
| `exclude` | string[] | blocklist por sufixo de hostname (`research-search.js:117`) |
| `language` | string | vira parâmetro `kl` da URL do provedor (`research-search.js:90`) |

Response de sucesso (`research-search.js:123`):

```json
{
  "provider": "ddg-html",
  "results": [
    { "title": "...", "url": "...", "canonical_url": "...",
      "domain": "exemplo.org", "snippet": "...", "provider": "ddg-html" }
  ]
}
```

Response de indisponibilidade — SEMPRE explícita, nunca fictícia (`research-search.js:92-105`):

| `unavailable` | Causa |
|---|---|
| `empty_query` | query vazia |
| `provider_error` | fetch falhou (`search_provider_unavailable` → HTTP não-ok em `fetchHtml`, `research-search.js:42`) |
| `parse_failed` | exceção no parse do HTML |
| `no_results` | zero resultados no HTML |
| (outra string) | mensagem de erro do transporte |

## 2. Provedor padrão `ddg-html`

- Sem credenciais: scraping do endpoint HTML do DuckDuckGo (`research-search.js:90`); timeout 20 s via `safeFetch` (`research-search.js:41`).
- Parse por expressões regulares sobre `result__a`/`result__snippet`, com `stripTags` de entidades (`research-search.js:47-77`).
- Transporte injetável: `setSearchFetcher(fn)` substitui o `safeFetch` em testes/fixtures; `setSearchFetcher(null)` volta ao padrão (`research-search.js:33-37`).

## 3. Canonicalização e dedupe

- `canonicalizeUrl` (`research-search.js:13-19`): remove fragmento e parâmetros de rastreio `utm_*|fbclid|gclid|ref|source` (case-insensitive); passa por `assertSafeUrl` (URL inválida/privada → throw).
- `domainOf` (`research-search.js:21-27`): hostname sem `www.`.
- Dedupe na resposta: `Set` por `canonical_url`, ordem do provedor preservada, para no `limit` (`research-search.js:106-122`).
- Dedupe persistente: `content_hash`/URL com índice único parcial — duplicata é ignorada no `INSERT` (`research.js:350-384`; índice `migrations.js:1381`).

## 4. Uso pelo motor

`nodeResearchWeb` chama `webSearchStructured` por subpergunta do plano (limite `max_sources_per_question`=5) e registra `origin:'web'` com `canonical_url`/`domain`/`provider` no metadata (`research.js:312-348`). Indisponibilidade com zero fontes adicionadas → audit `research.web_unavailable` (`research.js:341-346`).

## 5. Testes

| Cenário | Teste |
|---|---|
| Parse, dedupe canônico, limite, filtros de domínio | `tests/research-engine.test.mjs:40-54` |
| Indisponibilidade explícita (`provider_error`/`no_results`) | `tests/research-engine.test.mjs:56-67` |
| Canonicalização (utm/fragmento) e SSRF em `canonicalizeUrl` | `tests/research-engine.test.mjs:69-79` |
| E2E sem rede (fixtures de transporte) | `tests/research-security.test.mjs:59-60` |

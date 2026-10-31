# Segurança da Recuperação Web — Fase 4

Implementação: `retrievePage`/`htmlToText` em `server/research-search.js:129-175`, sobre a política
de `server/urlpolicy.js`. Ver `security-threat-model.md` (P4-1, P4-4).

## 1. Camadas de controle (`urlpolicy.js`)

| Controle | Onde | O que faz |
|---|---|---|
| `assertSafeUrl` | `urlpolicy.js:81-98` | Só http/https (`urlpolicy.js:12`), portas 80/443 (`:13`), sem credenciais na URL, IP literal privado bloqueado (inclui `169.254.169.254`, `:94-96`) |
| `isBlockedIPv4`/`isBlockedIPv6` | `urlpolicy.js:18-34,67-75` | Loopback, privadas, link-local, CGNAT, TEST-NET, multicast; IPv6: só unicast global 2000::/3 |
| `assertPublicHost` | `urlpolicy.js:106-117` | Resolve o DNS e recusa se QUALQUER endereço for não público (defesa p/ cliente remoto) |
| `guardedLookup` | `urlpolicy.js:120-132` | `lookup` customizado que só devolve endereços públicos — valida no CONNECT (anti-DNS-rebinding) |
| `safeFetch` | `urlpolicy.js:179-195` | Revalida a URL e cada salto de redirecionamento (`resolveRedirect`, `:171-173`); máx. 3 saltos (`:14`), 2 MB (`:15`), timeout configurável; leitura com teto de bytes (`readCapped`, `:134-152`) |

## 2. `retrievePage` (`research-search.js:143-175`)

Sequência real:

1. Monta objeto base com `quality:'failed'` e `fetched_at` (`research-search.js:144-152`).
2. `assertSafeUrl(rawUrl)` — URL inválida/não-HTTP/privada → retorno `failed` com `error` (`research-search.js:154,173`).
3. **Fixture mode**: se `injectedFetcher` está setado, pula o DNS real (`assertPublicHost` é omitido só nesse caso); produção mantém a dupla verificação (`research-search.js:155-166`).
4. Fetch: `safeFetch` com IP fixado pós-DNS, timeout 30 s (`research-search.js:163`).
5. Conversão com `htmlToText`; vazio → `error:"empty_page"` (`research-search.js:168-169`).
6. Qualidade: `partial` se texto ≥ `KH_RETRIEVAL_MAX_BYTES` (default 500.000 bytes, `:8`), senão `full` (`research-search.js:170`).
7. Retorna `{url, final_url, text, content_hash: sha256(text), quality, fetched_at}`; qualquer exceção → `{quality:'failed', error}` truncado a 60 chars (`research-search.js:172-174`).

## 3. `htmlToText` (`research-search.js:129-136`)

- Remove `<script>` e `<style>` inteiros antes do strip de tags — conteúdo nunca é executado.
- Quebra linha em fechamento de blocos (`p|div|li|h1-6|tr`).
- `stripTags` remove tags e decodifica entidades básicas (`research-search.js:68-77`).
- Trunca em `KH_RETRIEVAL_MAX_BYTES` (default 500 KB; configurável via `JARVIS_RESEARCH_MAX_PAGE`).

## 4. Qualidade e hash

| `quality` | Significado | Origem |
|---|---|---|
| `snippet_only` | só snippet do provedor; página não recuperada | default no INSERT (`research.js:362`) |
| `full` | texto completo < limite | `research-search.js:170` |
| `partial` | texto truncado no limite | `research-search.js:170` |
| `failed` | fetch/bloqueio/página vazia | `research-search.js:149,169,173` |

- `content_hash` = SHA-256 do texto recuperado (`sha256`, `research-search.js:29`); gravação com `COALESCE` preserva hash de snippet (`research.js:398-406`).
- Conteúdo persistido truncado a 100.000 chars (`research.js:400`).
- Apenas fontes `full`/`partial` com conteúdo entram na extração de evidências (`research.js:419`).

## 5. Persistência do ciclo

`nodeResearchRetrieve` seleciona até `max_retrievals_per_project`=12 fontes `web` pendentes
(`quality='snippet_only' OR fetched_at IS NULL`) e atualiza `content`/`content_hash`/`quality`/
`canonical_url` (da `final_url` canonializada)/`fetched_at` (`research.js:387-412`).

## 6. Testes

| Cenário | Teste |
|---|---|
| Strip de script, hash de 64 chars, `full`, falha → `failed` | `tests/research-engine.test.mjs:81-97` |
| Injeção hostil armazenada como dado, nada executa, escopos intactos | `tests/research-security.test.mjs:182-189` |
| SSRF bloqueado em `canonicalizeUrl` (porta/loopback/file) | `tests/research-engine.test.mjs:74-78` |

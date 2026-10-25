# crawl4ai — egress fail-closed (preparado, **não aplicado**)

Correção para o serviço `crawl4ai` (imagem `unclecode/crawl4ai@sha256:bd36741e7bdd…`, versão 0.9.2)
que fecha o caminho em que a navegação aconteceria **sem** o proxy de pinning.

> **Estado:** patches validados em instância isolada e **não aplicados** no serviço compartilhado.
> Alterar/implantar o crawl4ai exige autorização própria.

## 1. Como o egress funciona hoje (verificado)

| Camada | O que faz | Onde |
|---|---|---|
| Validação de entrada | recusa URL inicial não pública (`validate_url_destination`) | `utils.py`, chamado em `api.py`/`server.py` |
| **Proxy de pinning** | resolve **uma vez**, recusa IP não global e disca o IP fixado; Chromium nunca resolve o destino | `egress_proxy.py` + `egress_broker.resolve_and_pin()` |
| Roteamento do browser | `enforce_egress()` remove proxy do chamador e define `proxy_config` | `egress_broker.py` |
| Inicialização | `lifespan()` inicia o `PinningProxy` e chama `set_egress_proxy()` **antes** de servir | `server.py:180-183` |

Evidências coletadas no serviço em execução:

- log de boot: `egress pinning proxy listening on http://127.0.0.1:<porta>`;
- sonda direta no proxy (socket) com `CRAWL4AI_ALLOW_INTERNAL_URLS=false`:
  `GET/CONNECT 127.0.0.1` → `403`, `169.254.169.254` → `403`, `192.168.2.40` → `403`, público → permitido;
- redirecionamentos público→loopback/LAN/metadados falham na navegação, e o corpo do erro
  corresponde ao `URL blocked` (11 caracteres) devolvido pelo proxy — ou seja, o bloqueio
  acontece **na requisição**, não só na retenção da resposta;
- com `CRAWL4AI_ALLOW_INTERNAL_URLS=true` (opt-out explícito do operador) os mesmos destinos
  passam — comportamento documentado do `resolve_and_pin`, não um bypass do Chromium.

## 2. Lacuna encontrada

`enforce_egress()` era **fail-open**: sem `_EGRESS_PROXY_URL`, apenas não definia `proxy_config`
e a navegação seguia direta (Chromium resolveria o destino sozinho → DNS rebinding e loopback/LAN
sem bloqueio). Além disso, `init_permanent()` criava o browser permanente **sem** `enforce_egress()`;
com o proxy ausente, a configuração da requisição coincide com a padrão e o pool devolveria esse
browser não protegido.

## 3. Imagem candidata (construída e testada, não implantada)

`Dockerfile` neste diretório deriva da **mesma base pinada** em produção e aplica os dois patches
no build, validando sintaxe e presença de `EgressNotReady`:

```bash
docker build -t crawl4ai-egress:failclosed-g10 deploy/crawl4ai-egress-failclosed/
docker run --rm --entrypoint python3 crawl4ai-egress:failclosed-g10 -c \
  "import sys; sys.path.insert(0,'/app'); from egress_broker import EgressNotReady; print(EgressNotReady.__name__)"
```

Imagem construída nesta rodada: `crawl4ai-egress:failclosed-g10` (base
`unclecode/crawl4ai@sha256:bd36741e…`). Não substitui o serviço em produção.

## 3.1 Patches

| Arquivo | Mudança |
|---|---|
| `egress_broker.failclosed.patch` | `enforce_egress()` levanta `EgressNotReady` quando o proxy não está em execução; remove o `try/except: pass` que engolia falha de import |
| `server.permanent-browser.patch` | `init_permanent(get_default_browser_config())` — o browser permanente usa o mesmo config endurecido das requisições |

Aplicação (dentro de uma cópia da imagem, nunca direto no serviço compartilhado):

```bash
docker cp egress_broker.failclosed.patch  <container>:/tmp/
docker cp server.permanent-browser.patch  <container>:/tmp/
docker exec <container> sh -c 'cd /app && patch -p1 < /tmp/egress_broker.failclosed.patch && patch -p1 < /tmp/server.permanent-browser.patch'
docker restart <container>
```

Rollback: `patch -R -p1` com os mesmos arquivos, ou recriar o container a partir da imagem original
(os patches são as únicas alterações).

## 4. Validação executada em instância isolada

Container `c4ai-egress-test` (imagem idêntica, rede própria, token efêmero, porta 19000).

| Caso | Resultado |
|---|---|
| Boot com patch | OK — `egress pinning proxy listening`, `/health` 200 |
| Crawl público (`https://example.com/`) | 200 com conteúdo |
| URL interna direta | 400 `URL blocked (SSRF protection)` |
| Redirect público → `127.0.0.1` | navegação bloqueada (proxy 403) |
| Redirect público → `localhost` | bloqueado |
| Redirect público → `169.254.169.254` | bloqueado |
| Redirect público → `192.168.2.40` (LAN) | bloqueado |
| `enforce_egress()` sem proxy (processo novo) | **`EgressNotReady`** — fail-closed |
| Suíte de segurança do próprio crawl4ai | 64 passam; 7 falham por caminho de repo (`/app/../utils.py`), pré-existente e independente do patch |

## 5. Bateria de validação na imagem candidata (esta rodada)

| Caso | Resultado |
|---|---|
| Boot + proxy | `egress pinning proxy listening on http://127.0.0.1:<porta>`, `/health` 200 |
| `EgressNotReady` importável | sim |
| Público (`https://example.com/`) | 200 com conteúdo |
| Interno direto (loopback / metadados / LAN) | 400 `URL blocked (SSRF protection)` |
| Redirect → `127.0.0.1` | bloqueado (proxy 403) |
| Redirect → `localtest.me` (nome público que resolve para loopback) | bloqueado |
| Redirect → `169.254.169.254` | bloqueado |
| **WebSocket** `Upgrade` → loopback / metadados | **403** no proxy |
| **WSS** `CONNECT` → loopback | **403** no proxy |
| `enforce_egress()` sem proxy | `EgressNotReady` (fail-closed) |
| Proxy morto (`http://127.0.0.1:1`) | `proxy_config` aponta para o proxy morto — nunca conexão direta |
| Suíte de segurança do próprio crawl4ai | 64 passam; 7 falham por caminho de repo (`/app/../utils.py`), pré-existente |

Falha de inicialização é fail-closed por construção: o `lifespan` inicia o proxy antes de servir;
uma exceção ali aborta o startup (comprovado empiricamente quando um patch com nome errado
derrubou o worker com "Application startup failed").

## 6. Limites conhecidos (não resolvidos por estes patches)

- `CRAWL4AI_ALLOW_INTERNAL_URLS=true` continua sendo opt-out consciente do operador e desliga o
  bloqueio de IP no `resolve_and_pin`. Manter `false` em produção.
- WebSocket: validado no nível do proxy (`Upgrade`/`CONNECT` → 403 para destinos internos); não
  foi exercitado um servidor WS público real.
- O container em produção roda com rootfs **read-only**, o que impede patch em tempo de execução:
  a aplicação exige reconstruir a imagem ou montar os arquivos corrigidos.

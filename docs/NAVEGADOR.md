# Navegador (browser_action) — instalação, modos, limites e diagnóstico

> Capacidade de automação de páginas do J.A.R.V.I.S. Dois modos de execução, um contrato explícito
> e **nenhuma shell arbitrária**. Toda navegação passa por **aprovação humana** no fluxo já
> existente (o mesmo de `cli_agent`, `rea_analyze` e `openhands_task`).

## 1. Como o agente usa

Ferramenta `browser_action` (escopo `web`), com **lista fechada** de operações:

| `op` | Parâmetros | Resultado |
|---|---|---|
| `navigate` | `url` | título, URL final, host |
| `extract` | `url?`, `selector?` | trecho de texto (página inteira ou do seletor) |
| `click` | `url?`, `selector` | URL final após o clique |
| `fill` | `url?`, `selector`, `text` | URL final após o preenchimento |
| `wait_for` | `url?`, `selector?`, `timeoutMs?` | confirma a espera |
| `screenshot` | `url?` | apenas o **tamanho** da captura (o binário não é devolvido à conversa) |

Não existem — por decisão de projeto — operações de `eval`/JavaScript arbitrário, download, upload,
execução de shell, leitura de arquivos locais, cookies ou storage. Pedido fora da lista é recusado
com `unsupported_op` **antes** de virar aprovação.

### Fluxo (idêntico ao restante do produto)

1. O agente chama `browser_action` → o pedido é **validado** (operação + destino) e vira uma
   aprovação `pending` (`browser_action(requested)` na auditoria).
2. A pessoa aprova ou nega no painel. O portão é **reavaliado na aprovação** (integração ligada).
3. Aprovado → execução única (`browser_action(started)` → `…(done|error|unknown)`), com
   `execution_evidence` (estado, verificação, duração) — nunca conteúdo sensível.
4. Negado → nada é executado (`…(denied)`). Decisão repetida → `409 already_resolved`.
5. **Aprovações não expiram automaticamente** e não são reexecutadas sozinhas (política vigente,
   preservada por esta capacidade).

## 2. Configuração (Configurações → Integrações → “Navegador (Playwright)”)

| Campo | Significado |
|---|---|
| `enabled` | liga/desliga a capacidade. **Padrão: desligada.** |
| `command` (endereço) | **vazio → MODO LOCAL** (navegador dentro do container). **Preenchido → MODO REMOTO** (worker externo nesse endereço). |
| `apiKey` | token do worker (modo remoto). Nunca é devolvido pela API (apenas `hasKey`). |

O endereço do navegador **nunca** é fixo no código: vem desta configuração. Trocar de modo é trocar
a configuração, sem alterar o loop do agente.

## 3. Modo local (`enabled` sem endereço) — navegador no container

```bash
# dentro da imagem (ou no container), uma vez:
cd /app/server
npm install --no-audit --no-fund --no-save playwright-core@1.64.1
npx --yes playwright-core@1.64.1 install --with-deps chromium
```

No build da imagem existe a opção explícita:

```bash
docker build --build-arg INSTALL_BROWSER=1 -t assistente-pessoal:browser .
```

`INSTALL_BROWSER=0` (padrão) mantém a imagem enxuta; o modo local responde então
`browser_unavailable` com a instrução acima — falha **explícita e acionável**, nunca silenciosa.

**Topologia:** no modo local o navegador roda no **mesmo processo/container do JARVIS**, então
`127.0.0.1` é o próprio container. Para alcançar algo do host seria preciso o DNS do gateway do
Docker (`host.docker.internal` ou o IP da bridge) — e, de todo modo, destinos loopback/privados/
metadados são **recusados pela política** (ver §5).

## 4. Modo remoto (`enabled` com endereço) — worker externo autenticado

```bash
# no host ou em um container/serviço separado:
JARVIS_BROWSER_TOKEN="<token longo e aleatório>" \
JARVIS_BROWSER_PORT=7788 JARVIS_BROWSER_BIND=127.0.0.1 \
  node scripts/browser-worker.mjs
```

Contrato (o mesmo consumido por `server/browser.js`):

| Rota | Corpo | Resposta |
|---|---|---|
| `POST /run` | `{ runId, op, url?, selector?, text?, timeoutMs? }` | `{ state, title?, finalUrl?, host?, text?, screenshotBytes?, error? }` |
| `POST /cancel` | `{ runId }` | `{ cancelled }` |
| `GET /health` | — | `{ ok, engine, mode }` |

Autenticação por `Authorization: Bearer <token>` em `/run` e `/cancel`; **sem token o worker não
inicia** (fail-closed) e o bind padrão é `127.0.0.1` (nunca `0.0.0.0` por omissão). Em Docker, o
container do JARVIS alcança o worker pelo **nome do serviço na mesma rede** (ex.: `http://browser-worker:7788`),
nunca por `127.0.0.1` — dentro do container, loopback é o próprio JARVIS.

## 5. Segurança e limites

- **Destino:** `urlpolicy` (o mesmo módulo do `fetch_url`/`crawl_page`) recusa esquemas não-HTTP(S),
  credenciais na URL, portas fora do padrão e IP literal de loopback/redes privadas/CGNAT/link-local
  (**inclusive `169.254.169.254`**, metadados de cloud). Antes de navegar, o **nome também é
  resolvido** e recusado se apontar para endereço bloqueado; no modo local há ainda interceptação
  de requisições que revalida cada destino.
- **Segredos:** nenhum cookie, header de autorização, token ou corpo de credencial é devolvido,
  auditado ou registrado — a resposta do worker passa por redação antes de chegar à conversa.
- **Isolamento:** cada execução usa um **contexto novo** (sem reaproveitar cookies/armazenamento) e
  é fechada ao final; downloads desabilitados.
- **Tempo e cancelamento:** teto de 60 s por operação (piso 1 s, configurável até o teto) e
  cancelamento cooperativo (`POST /cancel` no worker; abort local no modo local).
- **Limites conhecidos:** (a) verificação de DNS antes da navegação tem janela TOCTOU teórica —
  mitigada pela rede isolada e pela lista fechada de operações; (b) `screenshot` não devolve imagem
  à conversa, apenas tamanho; (c) páginas que exigem autenticação do usuário não são suportadas
  (nenhuma credencial é injetada); (d) sites com desafios anti-bot podem falhar.

## 6. Diagnóstico

- `GET /api/diagnostics` traz `integracao:navegador` (`detalhes.modo` = `off|local|remote`,
  `endpoint` classificado — interno/externo — e `hasToken`, nunca o token) e `tool:browser_action`.
- `GET /api/skills`/painel: a ferramenta aparece no inventário como qualquer outra, com portão,
  dependências e limites.
- Erros são códigos estáveis: `browser_disabled`, `unsupported_op`, `blocked_destination`,
  `url_required`, `selector_required`, `selector_too_long`, `text_too_long`, `browser_unavailable`,
  `browser_unreachable`, `browser_unauthorized`, `browser_protocol_error`, `browser_timeout`,
  `browser_cancelled`, `browser_error`.
- No painel, a aprovação aparece como qualquer outra; o estado final exibido vem do backend
  (`done|error|interrupted|denied`), nunca de texto do modelo.

## 7. Testes

`tests/browser-tool.test.mjs` cobre: lista fechada de operações, política de destino (literal e por
DNS), limites de seletor/texto/timeout, resolução de modo, contrato remoto (sucesso, 401, host
inacessível, timeout, resposta fora do contrato), indisponibilidade do modo local, redação de
segredos, e o **fluxo de aprovação** ponta a ponta (pendente → negado sem execução → aprovado com
execução única → replay recusado → ownership isolado → auditoria/evidência correlacionadas).

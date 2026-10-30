# Publicação controlada, SSRF e implantação 1.7.5 — relatório de execução

**Data:** 2026-10-24 (fase de preparação)
**Projeto:** J.A.R.V.I.S. (`/opt/laytech-ai/AssistentePessoal`)
**Referência:** `docs/ENTREGA-CONTINUIDADE-G5-G9-2026-10-24.md`

> **Resumo do estado:** todo o trabalho técnico desta fase foi executado e validado localmente.
> **Nada foi publicado e nada foi implantado** — não há autorização inequívoca para push, PR,
> merge ou deploy nesta rodada. Produção permanece em `951cf3d` (1.7.4), intacta.

---

## 0. Errata do relatório anterior

O relatório de continuidade afirmou que o proxy de pinning do crawl4ai estava **inativo**
(`get_egress_proxy() == None`). **Essa conclusão estava errada**: a medição foi feita em um
processo Python novo, onde o estado do módulo é vazio por definição. O proxy é iniciado no
`lifespan` do serviço (`server.py:180-183`) e está ativo — confirmado por log de boot
(`egress pinning proxy listening on http://127.0.0.1:<porta>`) e por sonda direta no socket
(§3). O risco residual de SSRF é menor do que o registrado, mas **não é zero** (§3.4).

---

## 1. Baseline e conjunto exato de commits

| Item | Valor |
|---|---|
| Branch | `fix/g5-g9-continuidade-20261024` |
| HEAD | `5817d95e3565f33a10132ce156c9e6dd3f12cd77` |
| Upstream | **nenhum** (branch nunca publicada) |
| `origin/main` | `d0d9cac9730d5bd77cd9d6e33f161b51ebbb96d2` |
| Divergência | 7 commits locais à frente, 0 atrás |
| PRs abertas | nenhuma |
| Working tree | apenas `docker-compose.yml` (não rastreado) e a remoção local de `docker-compose.jarvis.yml` — **preservados e fora dos commits** |

**Conjunto real de commits (por `git log`, não por presunção):**

| Commit | Tipo | Conteúdo |
|---|---|---|
| `a1906e5` | código | `crawl_page` valida o destino final após redirecionamentos |
| `e7e8599` | código | cancelamento interrompe a chamada em voo + `testProvider` valida o contrato |
| `235eafa` | código | cabeçalhos de segurança no SSR do painel |
| `99b710c` | docs | relatório da continuidade G5–G9 |
| `41ff0da` | docs | registro das reinicializações observadas |
| `74beba5` | código | entrypoint registra qual componente encerrou o container |
| `5817d95` | docs | patches fail-closed do egress do crawl4ai (preparados) |

Os commits `99b710c`/`41ff0da` são **somente documentação**; `git diff --stat 235eafa..HEAD`
mostra apenas o relatório. O artefato candidato construído a partir de `235eafa` corresponde,
portanto, ao mesmo código de `41ff0da`; o candidato atual foi reconstruído a partir de `5817d95`.

**Runtime de produção (inalterado):** `assistente-pessoal:951cf3d` (`sha256:b45c5ebf0e2f…`),
1.7.4, `healthy`, `restarts=2`.

---

## 2. Publicação e PR — `BLOCKED-AUTHORIZATION`

**Nada foi publicado.** Não houve `git push`, criação de PR, merge ou deploy. O branch local
continua sem upstream.

**Bloqueio preciso:** a instrução desta fase condiciona publicação a autorização inequívoca
("Só publique o branch ou abra o PR se houver autorização inequívoca aplicável… Não faça merge
nem deploy por inferência"). Não há autorização explícita nesta rodada.

**O que está pronto (basta uma palavra de autorização):**

```bash
git push -u origin fix/g5-g9-continuidade-20261024
gh pr create --base main --head fix/g5-g9-continuidade-20261024 \
  --title "G5–G9: SSRF, cancelamento, cabeçalhos do painel e diagnóstico de reinício" \
  --body-file <descrição abaixo>
```

### 2.1 Descrição de PR preparada

> **Objetivo** — fechar pendências de segurança e robustez identificadas nas fases anteriores,
> sem ampliar permissões nem alterar contas.
>
> **Causa-raiz e mudanças**
> 1. `crawl_page` validava apenas a URL inicial; o crawl4ai segue redirecionamentos e `/md` não
>    informa o destino final. Passa a usar `POST /crawl` (único que devolve `redirected_url`) e
>    revalida o destino final, retendo o conteúdo quando não é público (auditoria
>    `redirect_blocked`).
> 2. `cancelRun` só marcava flag entre passos: a chamada de provedor em voo seguia até o timeout.
>    Agora há `AbortController` por run combinado com o orçamento da tentativa.
> 3. O botão "Testar" consultava `/models` (falso positivo: Hermes lista modelos e trava em
>    `/chat/completions`) e não tinha timeout. Passa a exigir completion mínima com `choices` e
>    timeout de 10 s.
> 4. O painel não enviava cabeçalho de segurança algum. Passa a enviar `nosniff`,
>    `referrer-policy`, `x-frame-options: SAMEORIGIN` e `frame-ancestors 'self'` em 200/404/500.
> 5. O entrypoint não registrava qual componente encerrou o container, o que impediu diagnosticar
>    duas reinicializações graciosas. Passa a registrar índice e status (`wait -n -p`).
>
> **Testes** — 575 backend, 108 frontend, lint dos arquivos alterados limpo, `npm audit` 0,
> `buildx --check` sem avisos, build `node-server` OK, imagem candidata com smoke `healthy`.
>
> **Riscos residuais** — resolução final do crawl4ai fora do controle do Jarvis (SSRF cego
> permanece; patches fail-closed preparados em `deploy/crawl4ai-egress-failclosed/`); CI remoto
> bloqueado por faturamento; Hermes intermitente.
>
> **Rollback** — reverter o merge; sem migração de banco e sem alteração de Compose.

---

## 3. Fase C — egress do crawl4ai (análise e mitigação preparada)

### 3.1 Versão e ciclo de inicialização (verificado no serviço em execução)

| Item | Valor |
|---|---|
| Imagem | `unclecode/crawl4ai@sha256:bd36741e7bdd35ddc1a05d9183e1d6d8cefb61dd640d944a25d026b76e917690` |
| Versão | `0.9.2` (`/health`) |
| Entrypoint | `bash entrypoint.sh` → `supervisord` (redis + gunicorn/uvicorn) |
| Rootfs | **read-only** (impede patch em runtime) |
| Rede | `CNC_APP_PROD_01`, sem portas publicadas |
| Egress | `PinningProxy` iniciado no `lifespan` **antes** de servir; `set_egress_proxy()` chamado logo após `start()` |

### 3.2 Evidências de que o proxy é o ponto de controle

| Verificação | Resultado |
|---|---|
| Log de boot | `egress pinning proxy listening on http://127.0.0.1:<porta>` (4 boots registrados) |
| Sonda direta no socket do proxy (`ALLOW_INTERNAL_URLS=false`) | `GET`/`CONNECT 127.0.0.1` → **403**; `169.254.169.254` → **403**; `192.168.2.40` → **403**; público → permitido |
| Crawl público | 200 com conteúdo |
| URL interna direta | 400 `URL blocked (SSRF protection)` (validador de entrada) |
| Redirect público → `127.0.0.1` / `localhost` | navegação falha; corpo do erro = `URL blocked` (11 caracteres) devolvido **pelo proxy** |
| Redirect público → `169.254.169.254` / `192.168.2.40` | bloqueado |
| `ALLOW_INTERNAL_URLS=true` (opt-out do operador) | os mesmos destinos passam — comportamento documentado do `resolve_and_pin`, não bypass do Chromium |

Conclusão: **o bloqueio ocorre na requisição**, não apenas na retenção da resposta. O Chromium
não resolve o destino — ele pede `CONNECT host:port` ao proxy.

### 3.3 Lacuna encontrada e patch preparado (fail-open)

`enforce_egress()` era fail-open: sem `_EGRESS_PROXY_URL` apenas não definia `proxy_config` e a
navegação seguia direta. Além disso, `init_permanent()` criava o browser permanente **sem**
`enforce_egress()`; com o proxy ausente, a config da requisição coincide com a padrão e o pool
devolveria esse browser não protegido.

| Artefato | Conteúdo |
|---|---|
| `deploy/crawl4ai-egress-failclosed/egress_broker.failclosed.patch` | `enforce_egress()` levanta `EgressNotReady` sem proxy; remove `try/except: pass` |
| `deploy/crawl4ai-egress-failclosed/server.permanent-browser.patch` | browser permanente via `get_default_browser_config()` |
| `deploy/crawl4ai-egress-failclosed/README.md` | procedimento, evidências, rollback e limites |

**Validação em instância isolada** (mesma imagem, rede própria, token efêmero, porta 19000):

| Caso | Resultado |
|---|---|
| Boot com patch | OK, `/health` 200 |
| Público | 200 com conteúdo |
| Interno direto | 400 |
| Redirect → loopback / localhost / metadados / LAN | bloqueados |
| `enforce_egress()` sem proxy (processo novo) | **`EgressNotReady`** (fail-closed) |
| Suíte de segurança do próprio crawl4ai | 64 passam; 7 falham por caminho de repo (`/app/../utils.py`), pré-existente |

O container isolado, a rede e o token de teste foram removidos. **O serviço compartilhado não foi
alterado** (rootfs read-only e ausência de autorização).

### 3.4 Risco residual (não declarado fechado)

- A resolução final continua no serviço remoto: os patches fecham o fail-open, mas só entram em
  vigor quando o crawl4ai for reconstruído/implantado com autorização.
- `CRAWL4AI_ALLOW_INTERNAL_URLS=true` desliga o bloqueio de IP — deve permanecer `false`.
- WebSocket (`ws://`) não foi testado especificamente.

---

## 4. Fase B/D — testes, build e artefato

Executados **nesta rodada** (não herdados de execuções anteriores):

| Verificação | Resultado |
|---|---|
| `node --no-warnings --test tests/*.test.mjs` | **575/575**, exit `0` |
| `npx vitest run` | **108/108** em 21 arquivos, exit `0` |
| `npx eslint` nos arquivos alterados | limpo; `server/llm.js` e `server/db.js` mantêm formatação preexistente (56/55 avisos de prettier, baseline) |
| `npm audit` (prod e dev) | **0 vulnerabilidades** |
| `git diff --check origin/main..HEAD` | exit `0` |
| `docker buildx build --check .` | *no warnings found* |
| `NITRO_PRESET=node-server npm run build` | exit `0` |
| Imagem candidata | `assistente-pessoal:cand-5817d95`, `sha256:1271956eda7b…`, `revision=5817d95`, `version=1.7.5`, `RELEASE_BUILD=1` |
| Smoke isolado do candidato | `healthy`, `restarts=0`, API 1.7.5, painel com os 4 cabeçalhos |

**Implantação: não executada** (§2). Nenhum backup novo foi necessário porque não houve alteração
de runtime; os backups existentes permanecem válidos.

---

## 5. Fase E — integrações (medido agora)

| Integração | Estado | Evidência |
|---|---|---|
| **Ollama** | `PASS` | `/chat/completions` 200 com `choices` |
| **crawl4ai** | `PASS` | proxy ativo; público 200; interno 400; redirect interno bloqueado |
| **Headroom** | `PASS` | `/chat/completions` 200 com chave |
| **Context7** | `PASS` | `initialize` MCP 200; `context7_docs` devolve documentação |
| **XTTS/TTS** | `PASS` | `/api/tts` 200, `audio/wav` |
| **Gigabrain** | `PASS` (leitura) | `gigabrain_recall` devolveu memória real do projeto |
| **REA** | `PASS` | fluxo completo: pedido → aprovação → execução (1,3 s) → `done` + Evidence `ev_24da17f0…`; auditoria `requested/approved/started/done` |
| **Hermes** | `FAIL` (intermitente) | 1ª completion 200 em **66 s**; 2ª **>120 s sem resposta**. Não é credencial: `/models` responde e há chave válida |
| **OmniRoute** | `CONFIG-BLOCKED` | container `omniroute` ativo; `401 AUTH_002` — falta `providers.omniroute.apiKey` |
| **OpenClaw** | `CONFIG-BLOCKED` | `403 "Proxy client attribution is required…"` — exige `gateway.trustedProxies` no gateway + chave |
| **IMAP/SMTP** | `CONFIG-BLOCKED` | `comms.<conta>.enabled/user/appPassword` ausentes; sem config o transporte é **mock em memória** (nunca envia de verdade) |
| **Telegram** | `CONFIG-BLOCKED` | `comms.telegram.enabled=false`; exige `botToken` + `chatId` |
| **Odysseus** | `NOT-INTEGRATED` | `GET /` 200 (UI), mas nenhum consumidor: `cli_agent` só executa integrações `kind: cli`; Odysseus é `kind: http` |
| **OpenHands** | `NOT-TESTED` | `GET /api/conversations` 200 (API e auth OK); a delegação `POST` não foi exercitada (efeito externo) |
| **Navegador** | `DISABLED-BY-POLICY` | nenhum agente possui `browser_action` |
| **Avatar 3D** | `PASS` com limitação | fallback 2D testado; WebGL real não validado em headless |

### 5.1 Defeitos independentes de credenciais corrigidos nesta fase

- `testProvider` fail-open/falso positivo → contrato funcional + timeout (`e7e8599`).
- `cancelRun` sem interrupção em voo → `AbortController` (`e7e8599`).
- Entrypoint sem identificação do componente que encerrou → `wait -n -p` (`74beba5`).

### 5.2 Observação de exposição (fora do escopo do Jarvis, registrada)

O container `omniroute` publica `0.0.0.0:3012` e `0.0.0.0:20128` no host — exposição em todas as
interfaces. Não foi alterado (serviço de terceiros); recomenda-se restringir a `127.0.0.1`.

---

## 6. Investigação das reinicializações

| Evidência | Valor |
|---|---|
| Container | criado em `20:40:09Z` (deploy), **não recriado** depois |
| `RestartCount` | 2 |
| `exitCode` | 0 (saída limpa) |
| `OOMKilled` | `false` |
| Erros no log | nenhum |
| 1ª parada | `22:44:44.8Z`, após ~2 h de operação saudável |
| 2ª parada | `22:44:58.5Z`, ~9 s após o boot anterior |
| Estável depois | sim (sem novas paradas desde `22:45:02Z`) |
| Eventos do Docker | **perdidos** (rotacionados) — não foi possível atribuir o sinal |
| Automação de restart no host | nenhuma (sem watchtower/autoheal; cron só registra conectividade) |

O entrypoint usa `wait -n`: quando **qualquer** filho termina, o conjunto inteiro para e o Docker
reinicia. Como nada registrava qual filho saiu, a causa é **indeterminável** com a evidência
disponível — e não é inventada aqui. A correção `74beba5` faz a próxima ocorrência registrar
índice, PID e status do componente, viabilizando o diagnóstico.

---

## 7. Contas, banco e permissões

| Verificação | Resultado |
|---|---|
| `PRAGMA integrity_check` | `ok` |
| `PRAGMA foreign_key_check` | sem linhas |
| `user_version` | `12` (nenhuma migração) |
| Contas | **7 cadastradas, 1 ativa — inalteradas** (nenhuma criada, removida, renomeada ou desativada) |
| Senhas/sessões | não redefinidas |
| Agentes / memórias | 4 / 4 — inalterados |
| Tokens de serviço ativos | **0** (os dois tokens de teste foram revogados) |
| Auditoria | 247 registros, íntegra |
| Permissões | nenhuma ampliada; navegador segue não concedido |

Artefatos de teste removidos: alvo e resultado do REA (`data/rea/targets/e2e-probe`, JSON gerado),
tokens revogados, container/rede/token do crawl4ai isolado eliminados. O recibo em
`data/rea/index.jsonl` foi mantido (log append-only de execução real).

---

## 8. Bloqueios externos e ações humanas

| Bloqueio | Ação exata | Impacto |
|---|---|---|
| Autorização de publicação | autorizar push/PR explicitamente | branch fica local; nada integrado |
| Autorização de deploy | autorizar implantação da 1.7.5 | produção continua 1.7.4 |
| Faturamento do GitHub Actions | *Settings → Billing & plans* → regularizar/limitar gastos | CI remoto não executa (0 steps, ~2 s) |
| Reconstruir crawl4ai com os patches | aplicar `deploy/crawl4ai-egress-failclosed/` na imagem e implantar | fail-open do egress permanece até lá |
| Hermes intermitente | investigar o runtime do agente (66 s a >120 s por completion) | agente `hermes` só é confiável via fallback |
| OmniRoute / OpenClaw / IMAP-SMTP / Telegram | fornecer chaves/config por mecanismo seguro | seguem bloqueados |
| DNS + certificado + listener 443 | provisionar infraestrutura | HTTPS/HSTS/`Secure` continuam bloqueados |
| Rotação da senha administrativa | painel → Segurança | exposição acidental anterior, registrada e não reproduzida |

---

## 9. Matriz final

| Fase | Veredito | Justificativa |
|---|---|---|
| **A — Reconciliação** | `PASS` | 7 commits identificados por `git log`; produção e artefato conferidos; locais preservados |
| **B — Revisão/PR** | `PASS-WITH-CONDITIONS` | diffs revisados, sem segredos/destrutivos/permissões; PR **preparada e não publicada** (falta autorização) |
| **C — SSRF/egress** | `PASS-WITH-CONDITIONS` | proxy comprovadamente no caminho e bloqueando na requisição; fail-open identificado e patch validado em isolamento; **não aplicado** e resolução final segue no serviço remoto |
| **D — Deploy 1.7.5** | `BLOCKED-AUTHORIZATION` | artefato construído e validado em isolamento; nenhum deploy executado |
| **E — Integrações** | `PASS-WITH-CONDITIONS` | 7 integrações `PASS`; Hermes `FAIL` intermitente; 4 `CONFIG-BLOCKED`; 1 `NOT-INTEGRATED`; 1 `NOT-TESTED`; navegador `DISABLED-BY-POLICY` |
| **CI remoto** | `BLOCKED-EXTERNAL` | sem execução real; nenhuma aprovação remota declarada |
| **G9 (contas/primeiro acesso)** | `NOT-STARTED` | adiado por decisão; contas intactas |

---

## 10. Próximos passos (ordenados)

1. **Autorizar publicação** → push do branch, PR, revisão e merge (CI seguirá vermelho até o
   faturamento ser regularizado; a evidência de qualidade é local e deve ser registrada como tal).
2. **Autorizar deploy** → construir a partir do commit aprovado, backup consistente, deploy e
   validação pós-deploy (incluindo `crawl_page` via `/crawl`, cancelamento, `testProvider` e
   cabeçalhos em 200/404/500).
3. **Reconstruir o crawl4ai** com os patches fail-closed e repetir a bateria de egress.
4. **Faturamento do GitHub Actions** para reativar o CI.
5. **HTTPS público** (DNS + certificado + 443) antes de qualquer HSTS/`Secure`.
6. **Hermes**: investigar latência/intermitência do runtime.
7. **Credenciais** de OmniRoute/OpenClaw/IMAP-SMTP/Telegram pelo painel.
8. **Restringir** a exposição `0.0.0.0` do `omniroute` a loopback.
9. **G9** — limpeza de contas e primeiro acesso, em etapa separada e autorizada.

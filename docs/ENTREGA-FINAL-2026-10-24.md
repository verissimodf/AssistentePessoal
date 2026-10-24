# Entrega final — recuperação de acesso e fechamento das fases 0–4

**Data:** 2026-10-24
**Repositório:** `verissimodf/AssistentePessoal`
**Conta pessoal:** `verissimo`
**Relatório de referência:** `docs/ENTREGA-E2E-2026-10-24.md`
**Veredito geral:** **PASS-WITH-CONDITIONS** — autenticação e fases 0–4 validada em produção; CI remoto bloqueado por faturamento da conta GitHub; camada HTTPS/HSTS indisponível no ambiente; integrações sem credenciais reais permanecem indisponíveis.

---

## 1. Causa-raiz da perda de acesso

A investigação foi feita sobre evidência de auditoria e código real, sem reset às cegas.

| Hipótese | Resultado | Evidência |
|---|---|---|
| A troca de senha no painel foi persistida e depois “sumiu” | **Refutada** | Não existia `auth.password_changed` para a conta no período relatado. O último evento anterior a esta sessão era de **2026-10-16** (`b1743c1a…`). A troca do operador **nunca chegou ao servidor**. |
| O painel estava autenticado no serviço real | **Refutada** | A origem `http://192.168.2.40:8090` era recusada pelo CORS (**403**). Sem serviço, o `AuthGate` deixa passar e o painel opera em **modo demonstração** com dados fictícios em `localStorage`. |
| Havia duas instâncias/bancos divergentes | **Refutada** | As portas `100.87.104.126:7777/8090` pertencem ao `scripts/tailnet-proxy.mjs` (relé TCP), não a uma segunda instância. Container e host reportam o mesmo commit e o mesmo banco. |
| O throttle de login era um defeito de produto | **Refutada** | `429 too_many_attempts` é o throttle progressivo documentado (`delayFor(1)=1 s`, 5 falhas = 5 min no par IP+conta, teto de 60 s só na conta). O teste anterior não aguardou a janela. |

**Causa-raiz:** a alteração de senha reportada não foi submetida ao backend. O painel, aberto por uma origem não autorizada, exibia o modo demonstração silenciosamente — o selo “Modo demonstração” tinha `hidden md:inline` e ficava invisível em telas pequenas. O operador acreditou ter alterado a senha de produção quando a ação ocorreu apenas no armazenamento local do navegador.

**Correções aplicadas:**

1. Origem LAN `http://192.168.2.40:8090` adicionada a `JARVIS_ALLOWED_ORIGINS` no Compose operacional (configuração local, não versionada).
2. Selo “Modo demonstração / Conectado ao Jarvis local” sempre visível no painel — PR **#61**, merge `cb83453`.
3. Credencial final gravada imediatamente após a troca, em arquivo `600` fora do repositório.

---

## 2. Gate A — recuperação e prova de autenticação

**Veredito: PASS.**

Prova executada em **Chrome real via CDP**, na origem LAN `http://192.168.2.40:8090`, com cookie de sessão real:

| Passo | Resultado |
|---|---|
| Login com a credencial final | `200` — `admin=verissimo` |
| `/api/auth/me` | `200` — identidade `verissimo` |
| `/api/auth/admins` | `200` |
| Troca de senha (`/api/auth/password`) | `200` — `sessionsRevoked` reportado |
| Sessão após recarga da página | `200` — cookie `HttpOnly` persistiu |
| Logout | `200` → `/api/auth/me` `401` |
| Login com a senha anterior | `401` |
| Login com a senha nova | `200` |
| Nova sessão após recarga | `200` |
| Logout final | `200` |

**Auditoria da troca:** `2026-10-24T19:38:29.651Z auth.password_changed` para o admin `e009c774-d7ac-478c-a5e0-02ee4ed7ef48`.

**Conta final:** `verissimo` (`e009c774-d7ac-478c-a5e0-02ee4ed7ef48`), ativa, proprietária de **4 agentes, 4 memórias e 1 aprovação**. Seis contas legadas/`#off` permanecem inativas, sem posse de dados e sem sessões. Não foi criada uma segunda conta administrativa.

**Procedimento da credencial:** a senha final está em
`/home/laytech/.local/share/jarvis-admin/credenciais-verissimo.txt`
(permissão `600`, proprietário `laytech`, fora do repositório e dos backups). Nenhum valor de senha, hash, token ou cookie foi impresso em log, relatório ou commit.

**Recuperação oficial:** `server/recuperar-acesso.js` com backup prévio verificado, bootstrap de uso único, auditoria `auth.recovery`, criação da conta `verissimo` e transferência explícita de titularidade (`confirm: "TRANSFERIR"`, reautenticação obrigatória).

---

## 3. Gate B — fases 0–4

**Veredito: PASS-WITH-CONDITIONS.**

### Fase 0 — versão, acesso e dados

| Item | Evidência |
|---|---|
| Versão em execução | `1.7.2`, commit `cb8345352c957f8ae416420318a8787da32ac7ab`, `mode=production`, `setupRequired=false` |
| Banco | `integrity_check=ok`, `foreign_key_check` limpo, `user_version=12` |
| Dados | agents=4, memories=4, ownership=13 (inclui 3 aprovações da validação), admin_settings=3, audit=176 |
| Contas administrativas | apenas `verissimo` ativa; 6 legadas inativas |
| Sessões/tokens | encerrados ao final da validação; nenhum token de serviço ativo |

### Fase 1 — skills e navegador

| Item | Evidência |
|---|---|
| Quatro skills builtin | `threejs-expert`, `gsap-motion`, `design-dna`, `karpathy-engineering` — `total=4` |
| Catálogo | `totalCatalog=4`, categorias presentes |
| `browser_action` desativado por padrão | `Integração "browser" não está habilitada em Configurações.` |
| Operação não suportada | `shell` recusada pelo mesmo portão (lista fechada: `navigate, extract, click, fill, wait_for, screenshot`) |
| Privilégio | navegador permanece **desligado e não concedido**; nenhuma permissão foi ampliada |

### Fase 2 — pesquisa com fontes

| Ferramenta | Resultado live |
|---|---|
| `fetch_url` | `https://example.com` → conteúdo externo com marcação de “não confiável” |
| `web_search` | DuckDuckGo → resultados com links e snippets |
| `crawl_page` | `https://example.com` → markdown limpo via crawl4ai |
| `context7_docs` | `react` → documentação real (`context7://libraries/reactjs/react.dev`) |

**SSRF — negativos comprovados:** `127.0.0.1`, `localhost`, `[::1]`, `192.168.2.40`, `10.0.0.1`, `100.87.104.126`, `169.254.169.254`, `file://` e metadados de nuvem foram recusados (`blocked_destination`, `port_not_allowed`, `protocol_not_allowed`). Redirecionamentos são revalidados a cada salto; a política não foi enfraquecida.

**Condição registrada:** `crawl_page` entrega a URL ao crawl4ai e depende da proteção SSRF desse serviço. No deploy atual o crawl4ai recusou loopback, IP LAN e nomes DNS internos (`crawl4ai 400: URL blocked (SSRF protection)`), mas não há validação local redundante antes da chamada. Recomenda-se `assertSafeUrl` + resolução DNS no Jarvis em evolução futura.

### Fase 3 — segurança contínua

| Controle | Evidência |
|---|---|
| Origem não autorizada | `403` para `evil.example`, `192.168.2.41:8090` e `Origin: null` |
| Sem sessão | `/api/auth/me` e `/api/agents` → `401` |
| Sem CSRF | `POST /api/agents` → `403` |
| Cookie | `HttpOnly; SameSite=Strict; Path=/; Max-Age=43200` |
| Rate limit | progressivo, auditado (`auth.login_throttled`) |
| Auditoria | eventos de login, troca de senha, recuperação, autorização e aprovação |
| Permissões | `data/master.key` `600`; `data/jarvis.db` ajustado para `600`; container roda como `1000:1000` |
| Rede | container na rede `CNC_APP_PROD_01` com IP `192.168.2.40`, **sem portas publicadas** (`Ports={}`) |
| Segredos | nenhum segredo rastreado no Git (apenas `.env.example`) |

**HSTS:** não foi adicionado ao hop HTTP interno. O bloco Nginx do repositório (`deploy/nginx-jarvis.laytech.com.br.conf`) é um rascunho que escuta apenas na porta 80 e não está carregado; o domínio público não resolve e não há terminação TLS ativa neste ambiente. Adicionar HSTS nesse hop seria incorreto. O local correto é a camada HTTPS (proxy/TLS ou CDN), quando existir.

**Condição registrada:** cookie sem `Secure` porque o acesso operacional é HTTP na LAN. Ao publicar por HTTPS, definir `JARVIS_COOKIE_SECURE=1`.

### Fase 4 — voz, avatar e multiagente

| Item | Evidência |
|---|---|
| Inferência real | Ollama `qwen2.5:7b` → `200`, resposta “Paris.” em 29 s |
| TTS | `/api/tts` → `200`, WAV PCM 16-bit mono 24 kHz, 133.708 bytes |
| Avatar | elemento `Jarvis 3D avatar` presente no DOM; fallback acessível ativo |
| WebGL | indisponível no Chrome headless deste host; fallback renderizado sem erro de aplicação |
| Roteamento | 4 perfis classificados: `realtime_voice`, `code_engineering`, `rag_knowledge`, `general` |
| Agentes | 4 agentes (`headroom`, `hermes`, `jarvis`, `omniroute`) responderam; provedores sem chave caíram para Ollama com `provider_fallback_success` auditado |
| Aprovações | `ls` enfileirado → aprovado → executado (`data | scripts | server`); `rm -rf` enfileirado → negado; portão reavaliado na resolução |
| Isolamento | listagens owner-scoped; dados legados invisíveis |
| Falhas | `context7_docs` com biblioteca inexistente e `fetch_url` com domínio inexistente retornaram erro tratado, sem vazar stack |

**Condições:** Hermes/Headroom/OpenClaw exigem chave e respondem `401/403` quando consultados diretamente; o chat funciona pelo fallback Ollama. OmniRoute não foi validado como integração real. E-mail permanece no transporte mock, sem credenciais IMAP/SMTP reais. Nenhuma credencial foi inventada.

---

## 4. Gate C — testes e publicação

### Suítes executadas

| Comando | Resultado | Exit |
|---|---|---|
| `node --no-warnings --test tests/*.test.mjs` | **545 testes, 545 pass, 0 fail** | `0` |
| `npx vitest run` | **20 arquivos, 103 testes, 103 pass** | `0` |
| `docker buildx build --check .` | “Check complete, no warnings found” | `0` |
| `git diff --check` | sem erros | `0` |

Testes específicos incluídos na suíte: `auth`, `password-change`, `http-auth`, `isolation`, `urlpolicy`, `browser-tool`, `hostpolicy`, `approvals-actions`, `migrations`, `voice-tts`, `security-hardening`, `phase2-fixes`.

### Publicação

| Item | Valor |
|---|---|
| Correção `safeFetch` | PR **#59** → `c75f12f` |
| Relatório E2E anterior | PR **#60** → `8e397eb` |
| Selo de modo demonstração | PR **#61** → **`cb83453`** |
| Relatório final | PR **#62** → **`5b90800`** |
| Branch-base | `main` |
| Push | normal, sem force push |
| CI remoto | **bloqueado por faturamento** — run `40125788008`: “The job was not started because recent account payments have failed or your spending limit needs to be increased.” |
| Workflows/proteções | mantidos habilitados; nenhum check fabricado ou desativado |

O merge da correção visual foi feito com equivalente local documentado, pois os jobs remotos não iniciam. Essa limitação **não** equivale a aprovação remota.

---

## 5. Gate D — build, implantação e validação

Implantação inicial do candidato funcional (a implantação final, reconstruída após o merge do relatório, está no §8):

| Item | Valor |
|---|---|
| Imagem implantada | `assistente-pessoal:cb83453` |
| Image ID | `sha256:ef9a5b070e44a681fd3fe4ac9def2f8a3a14a5984f994c02668aaf95adc15523` |
| Build time | `2026-10-24T19:32:57Z` |
| Versão | `1.7.2` |
| Commit | `cb8345352c957f8ae416420318a8787da32ac7ab` |
| Container | `6d1e92d84dff…`, `healthy`, `restarts=0` |
| Rede | `CNC_APP_PROD_01`, IP `192.168.2.40`, sem portas publicadas |
| Saúde | `/api/health` → `200`, commit e versão corretos |
| Preflight LAN | `204` para `http://192.168.2.40:8090` |
| Preflight tailnet | `204` para `http://100.87.104.126:8090` |
| Smoke isolado | API `200`, painel `200` em container separado antes do deploy |

**Validação pós-deploy:** autenticação e sessão (Chrome real), troca de senha auditada, inferência Ollama, TTS WAV, quatro perfis de roteamento, quatro agentes com fallback, aprovações (aprovar/negar), SSRF, CORS, CSRF, painel conectado sem modo demo e avatar com fallback.

---

## 6. Backups, integridade e rollback

| Backup | SHA-256 (prefixo) |
|---|---|
| `data/backups/jarvis-antes-deploy-cb83453-20261024T193624Z.db` | `1b18e1b432ad11be…` |
| `data/backups/jarvis-antes-reset04-20261024T193744Z.db` | `84e723cc250966f5…` |

Todos com `PRAGMA integrity_check = ok` antes e depois das operações. A imagem anterior funcional permanece disponível para rollback:

- `assistente-pessoal:c75f12f` (`sha256:294c9e622571…`)
- `assistente-pessoal:d3a9fab` (`sha256:95dc234eb169…`)

Nenhum volume foi removido, nenhum `git reset --hard`, `git clean` ou restauração destrutiva foi executado. O `docker-compose.yml` operacional e a remoção local de `docker-compose.jarvis.yml` foram preservados.

---

## 7. Bloqueios externos e condições residuais

| Item | Estado | Impacto | Ação necessária |
|---|---|---|---|
| GitHub Actions | **BLOCKED** (faturamento) | checks remotos não iniciam | regularizar pagamento/limite da conta GitHub |
| HTTPS/HSTS | **NOT-STARTED** (sem camada TLS ativa) | HSTS não pode ser aplicado corretamente | publicar atrás de TLS e então adicionar HSTS no proxy/CDN |
| Cookie `Secure` | condicionado ao HTTP LAN | cookie não usa `Secure` no hop interno | definir `JARVIS_COOKIE_SECURE=1` quando todo acesso for HTTPS |
| E-mail IMAP/SMTP | **CONFIG-BLOCKED** | envio/leitura reais indisponíveis; transporte mock | fornecer credenciais reais |
| OmniRoute | **CONFIG-BLOCKED** | integração não validada como real | fornecer endpoint/chave |
| Hermes/Headroom/OpenClaw | exigem chave | respondem `401/403`; chat usa fallback Ollama | fornecer chaves se forem usados diretamente |
| WebGL headless | limitação ambiental | avatar 3D não renderiza no Chrome headless | validar em navegador com GPU |
| `crawl_page` | defesa em profundidade | SSRF depende do crawl4ai | adicionar validação local em evolução futura |

---

## 8. Registro de implantação final

Após o merge do relatório, a árvore final foi reconstruída e implantada para que o SHA da imagem corresponda ao commit publicado.

| Item | Valor |
|---|---|
| Commit de código implantado | `5b90800d1e586528e85b090c26ceef2c73674730` (merge docs-only sobre `cb83453`) |
| Imagem | `assistente-pessoal:5b90800` |
| Image ID | `sha256:5019459df72ba45f54b18f92a493766b69550c03a3898b0e89a544aaf6a9dd2e` |
| Build time | `2026-10-24T19:50:39Z` |
| Versão | `1.7.2` |
| Saúde | `healthy`, `restarts=0`, `/api/health` com commit `5b90800…` |
| Backup pré-deploy | `data/backups/jarvis-antes-deploy-5b90800-20261024T195416Z.db` — `integrity=ok`, SHA-256 `3c08d8d62a917aba…` |
| Smoke isolado | API `200`, painel `200` |
| Preflight LAN | `204` |

**Validação pós-deploy (navegador real + API):** login `200`, `/api/auth/me` `200` (`verissimo`), sessão sobrevive à recarga, logout `200` → `401`; `skills=4`, `agents=4`, roteamento `general`, chat `200` e TTS `200` (WAV PCM 16-bit mono 24 kHz, 189.004 bytes).

**Estado final:** `sessions_active=0`, `tokens_active=0`, `integrity_check=ok`, `foreign_key_check` limpo, `user_version=12`, agents=4, memories=4, ownership=13, audit=181. A conta `verissimo` permanece ativa e proprietária dos 4 agentes e 4 memórias.

> O commit final deste relatório é uma continuação **docs-only** de `5b90800`; a árvore de código implantada é idêntica. A imagem registrada acima é a que está em execução.

## 9. Conclusão

O acesso administrativo de `verissimo` está recuperado e comprovado de forma persistente, com a identidade correta, privilégios administrativos, sessão sobrevivendo à recarga, logout invalidando a sessão, senha antiga rejeitada e senha nova aceita. As fases 0–4 foram validadas no candidato implantado, com 545 testes de backend e 103 testes de frontend verdes, banco íntegro e ownership preservado.

A entrega **não** é declarada pronta para produção sem ressalvas: o CI remoto continua bloqueado por faturamento, não existe camada HTTPS ativa para HSTS, e e-mail/OmniRoute permanecem sem credenciais reais. Essas condições estão registradas acima com impacto e ação necessária.

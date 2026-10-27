# Integrações LayTech — estado operacional

Atualizado em **2026-10-27** após publicação e rebuild da release **1.8.2**. A topologia do container foi
verificada agora; os resultados dos demais provedores abaixo continuam sendo a fotografia de
**2026-10-26** e não foram retestados neste fluxo.

## 1. Topologia atual

| Componente | Endereço | Observação |
| --- | --- | --- |
| API | `http://<ip-interno>:7777` (rede Docker) | sem porta publicada no host |
| Painel | `http://<ip-interno>:8090` (rede Docker) | público via `https://jarvis.laytech.com.br` |
| Container | `assistente-pessoal` | `assistente-pessoal:1.8.2`, `healthy`, `restarts=0`, versão 1.8.2, schema 15, commit publicado `88a3ce5` |
| Digest da imagem | SHA-256 | `sha256:98ee1d6b5758dd6a61368729717390dc6969bd2437e82fadb3f8331eaafce700` (rebuild 1.8.2) |
| Nginx | `nginx-app:80` | recebe do túnel Cloudflare |
| Cloudflare | `jarvis.laytech.com.br` | TLS/HSTS no edge |
| Dados | `/opt/laytech-ai/AssistentePessoal/data` | SQLite WAL + `master.key` 600 |
| MCP | `server/mcp.js` (stdio) | requer token de serviço com escopo mínimo |

O serviço systemd de usuário (`assistente-pessoal.service`) e o relé Tailscale descritos em
documentos antigos não são o caminho de produção atual; a produção usa o container + Nginx +
Cloudflare. Se o Tailscale for reativado, valide novamente as origens permitidas.

## 2. Provedores e integrações (verificado em 2026-10-26)

| Integração | Endereço | Configuração | Estado |
| --- | --- | --- | --- |
| Ollama | `http://ollama-llm:11434/v1` | modelo `qwen2.5:7b` | **OPERATIONAL** — `/models` 200 (9), chat real |
| Headroom | `http://headroom:8787/v1` | token no serviço, `qwen2.5:7b` | **OPERATIONAL** — `/models` 200 (9), chat 200 (~6,4 s) |
| OmniRoute | `http://omniroute:20128/v1` | `auto/best-coding`, chave | **OPERATIONAL** — `/models` 200 (268); chat real 200 (`Beam-1.0-501B-A23B`, `PONG`) |
| Hermes | gateway local | sessão por execução | **PASS-WITH-CONDITIONS** — `/models` 200 (1); chat depende do gateway |
| OpenClaw | `http://openclaw:18789/v1` | token presente, `kind: http` | **BLOCKED-CONFIGURATION** — `/healthz` 200, `/models` 200, chat 404 |
| OpenAI / Anthropic | APIs públicas | chave ausente | **BLOCKED-CONFIGURATION** |
| Context7 | `http://127.0.0.1:8000/mcp` | MCP | ferramenta `context7_docs`; não revalidado nesta auditoria |
| crawl4ai | `http://<ip-crawl4ai>:11235` | fail-closed egress | ferramenta `crawl_page`; não revalidado nesta auditoria |
| OpenHands | `http://127.0.0.1:8085` | HTTP | primeira execução pode montar runtime e demorar |
| Odysseus | `http://odysseus:8000/v1` | HTTP | não exposto como ferramenta de agente |
| REA | `rea-agents` na imagem | CLI/argv fixo | `rea_analyze` com aprovação |
| Gigabrain | MCP stdio | `data/gigabrain/` | `gigabrain_recall`/`remember` |
| AgentMail | `https://api.agentmail.to` (REST v0, Bearer) + webhook `POST /api/integrations/agentmail/webhook` (Svix) | Server-side: `server/agentmail.js`, migrações v13/v14 e tools `agentmail_read_email`/`agentmail_send_email` (D9); config via painel ou env fallback; inbox claim explícito | **DEPLOYED, INBOX REIVINDICADA** — ownership `claimed` confirmado e zero eventos sem owner. Não houve leitura de conteúdo nem envio real após o deploy v1.8.2; os E2E anteriores pertencem à 1.8.0. O MCP hospedado listado em `.mcp.json`/`opencode.json` é um caminho externo sem os controles Jarvis D9/ownership/auditoria; prefira ferramentas server-side. |

### 2.1 OpenClaw

O adaptador `server/http-integration.js` já implementa:

- allowlist de integração `kind: "http"` e `enabled: true`;
- URL vinda da configuração do administrador (sem URL arbitrária do modelo);
- `Authorization: Bearer` do segredo configurado;
- timeout de 30 s, limite de prompt (8.000) e de resposta (8.000);
- contrato OpenAI (`POST {base}/chat/completions`), extração de `choices[0].message.content`;
- auditoria apenas de ids/status, nunca prompt/resposta/chave.

Estado do gateway (`/home/node/.openclaw/openclaw.json`, sem expor segredos):

- `gateway.http.endpoints = null` → **chat desabilitado**;
- `gateway.trustedProxies = ["127.0.0.1/32", "::1/128"]` (correto; não inclui a sub-rede de clientes);
- `auth.mode = "token"` e token presente;
- `GET /healthz` 200; `GET /models` 200; `GET /v1/models` 404; `POST /v1/chat/completions` 404.

**Ação necessária (produção, fora deste repositório):** habilitar o endpoint de chat no gateway,
confirmar o token e executar um teste autorizado com mensagem sintética. Até lá, manter a
integração desabilitada para agentes. O agente remoto não recebe ferramentas nem shell.

### 2.2 OmniRoute e Headroom

São **independentes e complementares**:

- **OmniRoute** (`omniroute:20128/v1`) é um gateway multi-provedor. O catálogo tem 268 modelos e
  `auto/best-coding`. Chat conversacional real validado em 2026-10-26 com as credenciais já
  existentes (HTTP 200, `finish: stop`, resposta verificável `"PONG"`; nada foi alterado).
  O backend `auto/best-coding` responde em modo **streaming (SSE)** e pode gastar tokens de
  raciocínio antes do conteúdo (use orçamento de tokens adequado, ~300). Não faça chamadas pagas
  adicionais sem confirmar provedores conectados e orçamento.
- **Headroom** (`headroom:8787/v1`) é um proxy local de contexto/compactação, com 9 modelos e chat
  sintético validado. Ele não substitui o OmniRoute.
- O router do J.A.R.V.I.S. tem timeout por tentativa, fallback para Ollama e telemetria em
  `/api/router/telemetry` (escopo `skills:read`). Falhas de gateway não devem gerar loop infinito;
  monitore `fallbacksTriggered` e a taxa de erro.

## 3. E-mail e Telegram (estado atual)

| Canal | Configuração | Teste 2026-10-26 | Estado |
| --- | --- | --- | --- |
| Telegram | token + chatId presentes | `getMe` HTTP **404** | **BLOCKED-CONFIGURATION** (token inválido/revogado) |
| Gmail | conta + appPassword presentes | IMAP `authenticationFailed` | **BLOCKED-CONFIGURATION** (credencial/permissão) |
| Envio de e-mail | `JARVIS_MAIL_TRANSPORT` ausente | não testado | **mock** (nenhuma mensagem real) |
| WhatsApp | não testado | — | NOT-TESTED |
| Signal | desabilitado | — | desabilitado |

Nenhuma mensagem foi enviada a terceiros. Para habilitar:

1. Telegram: novo token no @BotFather, atualizar no painel, validar `getMe` e testar apenas no chat
   autorizado.
2. Gmail: corrigir senha de app/permissão IMAP, definir `JARVIS_MAIL_TRANSPORT=imap`, testar
   leitura e só depois envio com aprovação humana.

## 4. Segurança operacional

- Não publicar portas do container; a borda é Nginx/Cloudflare.
- Não colocar tokens em documentos, issues, logs ou relatórios.
- Integrações HTTP usam URL de configuração, não do modelo; não há SSRF arbitrário nesse caminho.
- Ações de host continuam sob `hostpolicy` + aprovação; agentes não recebem shell irrestrito.
- O HSTS de produção é emitido no edge; o rascunho HTTP interno versionado não deve conter HSTS
  (`tests/tls-config.test.mjs`).

## 5. Limitações conhecidas

- OpenClaw sem endpoint de chat; Odysseus sem endpoint OpenAI aberto.
- OpenHands pode ficar indisponível durante a primeira montagem do runtime.
- OmniRoute depende de provedores conectados/cota; Headroom depende do token do proxy.
- E-mail/Telegram exigem correção de credenciais; não há teste real de envio.
- Não há monitoramento contínuo de integrações; os testes acima são pontuais.

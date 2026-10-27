# Configuração

Atualizado para **1.9.0** (esquema 18). A configuração de aplicação é feita no painel e persistida
cifrada em `data/jarvis.db`; variáveis de ambiente cobrem infraestrutura e segurança.

## Proveniência dos valores

A aba **Proveniência** mostra, para cada caminho efetivo, de onde o valor vem
(`GET /api/settings/provenance`, escopo `settings:read`):

- **padrão** — valor de fábrica (`PERSONAL_DEFAULTS`/`GLOBAL_DEFAULTS`);
- **pessoal** — `admin_settings` do administrador;
- **global** — política da instalação (`host`, `integrations`, `voice.localVoiceUrl`), alterável
  apenas por administrador verificado.

Segredos aparecem somente como `secret: true`; variáveis sensíveis aparecem como
definida/não definida, sem valor. O servidor nunca devolve chaves, tokens ou senhas.

## Variáveis de ambiente

| Variável | Efeito |
| --- | --- |
| `JARVIS_DATA_DIR` | diretório de dados (`/app/data` no container) |
| `JARVIS_HOST` / `JARVIS_PORT` | bind da API; o entrypoint usa o IP do container, nunca `0.0.0.0` |
| `PANEL_PORT` | porta do painel (8090 no container) |
| `JARVIS_ALLOWED_ORIGINS` | origens permitidas, separadas por vírgula |
| `JARVIS_COOKIE_SECURE` | `1` para cookie `Secure` em HTTPS |
| `JARVIS_MAX_UPLOAD` / `JARVIS_MAX_DOCUMENT` | limites de upload/documento |
| `JARVIS_MASTER_KEY` | chave mestra alternativa ao `data/master.key` |
| `JARVIS_SERVICE_TOKEN` | token de serviço para MCP/scripts (criado no painel) |
| `JARVIS_GLOBAL_SKILLS_DIR` | hub de skills (padrão `$HOME/.agent-skills`) |
| `JARVIS_SKILLS_SETUP` | `builtin` (padrão), `off` ou `full` (rede opt-in) |
| `JARVIS_MAIL_TRANSPORT` | `imap` ativa o adaptador real de e-mail; ausente = mock |
| `XTTS_URL` | endpoint do TTS local (padrão `http://xtts-service:8000`) |
| `JARVIS_STT_URL` | serviço local whisper.cpp; profile Docker `stt`, padrão interno `http://stt:8080` |
| `GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI` | app OAuth Gmail; callback `/api/oauth/callback` |
| `MICROSOFT_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI` | app OAuth Microsoft Graph; callback `/api/oauth/callback` |
| `MICROSOFT_OAUTH_TENANT` | tenant Microsoft (padrão `common`) |
| `JARVIS_NO_LISTEN` | `1` para testes sem abrir socket |

OAuth e STT são capacidades opcionais. O OAuth precisa de aplicações registradas e credenciais no
`.env`; valores vazios desativam a conexão. Configuração operacional, callbacks, escopos e modelo
local fixado por hash: [`OPERACAO-FILA-STT-OAUTH-RETENCAO.md`](OPERACAO-FILA-STT-OAUTH-RETENCAO.md).

## Provedores de IA

Os endereços abaixo refletem a topologia Docker atual; no modo local use `127.0.0.1`/`localhost`.

| Provedor | URL base padrão | Chave | Estado 2026-10-26 |
| --- | --- | --- | --- |
| Ollama | `http://ollama-llm:11434/v1` | não | **OPERATIONAL** (`/models` 200, 9 modelos) |
| Anthropic | `https://api.anthropic.com` | sim | BLOCKED-CONFIGURATION sem chave |
| OpenAI | `https://api.openai.com/v1` | sim | BLOCKED-CONFIGURATION sem chave |
| HuggingFace | `https://router.huggingface.co/v1` | sim | não testado |
| OmniRoute | `http://omniroute:20128/v1` | sim | **OPERATIONAL** (`/models` 200, 268 modelos; chat real 200 `PONG`) |
| OpenCode Go | `https://opencode.ai/zen/v1` | sim | não testado |
| OpenRouter / Groq / Gemini | compatíveis com OpenAI | sim | não testados |
| OpenWebUI | `http://openwebui:8080/api` | sim | não testado |
| Headroom | `http://headroom:8787/v1` | sim | **OPERATIONAL** (`/models` 200, 9 modelos; chat 200) |
| Compatível com OpenAI | qualquer `/v1` | opcional | conforme configuração |

O estado “operacional” exige uma chamada real bem-sucedida; a mera presença do adaptador no código
não basta. O fallback local (Ollama) continua sendo o caminho seguro quando um gateway falha.

## Integrações de agentes

| Integração | Tipo | Endereço/config | Estado |
| --- | --- | --- | --- |
| Claude Code / Codex / OpenCode | CLI | comando com `{prompt}` | depende do CLI instalado/logado |
| Hermes | CLI/HTTP | gateway local | `/models` 200; chat depende de sessão/gateway |
| OpenClaw | HTTP | `http://openclaw:18789/v1` | **BLOCKED-CONFIGURATION** — `/healthz`/`/models` 200, chat 404 |
| Odysseus | HTTP | `http://odysseus:8000/v1` | não exposto como ferramenta de agente |
| OpenHands | HTTP | `http://127.0.0.1:8085` | primeira execução pode montar runtime e demorar |
| Context7 | MCP | `http://127.0.0.1:8000/mcp` | ferramenta `context7_docs` |
| crawl4ai | HTTP | `http://<ip-crawl4ai>:11235` | ferramenta `crawl_page` (fail-closed egress) |
| Headroom | HTTP | `http://headroom:8787/v1` | proxy de contexto; ver provedores |
| REA | CLI | `rea-agents` na imagem | ferramenta `rea_analyze` com aprovação |
| Gigabrain | CLI/MCP | store em `data/gigabrain/` | ferramentas `gigabrain_recall/remember` |

### OpenClaw

- O adaptador HTTP (`server/http-integration.js`) já aplica allowlist de integração, Bearer do
  settings, timeout de 30 s, limite de prompt/resposta e auditoria sem conteúdo.
- O gateway atual tem `gateway.http.endpoints = null`; `/v1/chat/completions` responde **404**.
  `gateway.trustedProxies` está restrito a loopback e `auth.mode = token`.
- Para habilitar: configurar o endpoint de chat no gateway, validar o token e executar um teste
  autorizado com mensagem sintética. Até lá, a integração deve permanecer **desabilitada para
  agentes**; não há execução de ferramentas pelo agente remoto.

### OmniRoute e Headroom

- São componentes **independentes e complementares**: OmniRoute multiplexa provedores;
  Headroom é um proxy local de contexto/compactação. O J.A.R.V.I.S. fala com cada um como
  provider OpenAI-compatible.
- OmniRoute: `auto/best-coding` disponível no catálogo; logs do gateway mostram pools `auto/*`
  vazios para alguns aliases. Não habilite chamadas pagas sem confirmar provedores conectados e
  orçamento.
- Headroom: requer token (`HEADROOM_PROXY_TOKEN` no serviço); a porta é publicada só em loopback.
  Chat sintético validado em 2026-10-26.
- Falhas de gateway caem no fallback local (Ollama); não há loops de retry infinito — o router
  tem timeout por tentativa e circuit breaker.

## Comunicações

| Canal | Configuração | Estado 2026-10-26 |
| --- | --- | --- |
| Telegram | `botToken` + `chatId` | token/chat presentes; `getMe` **404** (token inválido/revogado) — BLOCKED-CONFIGURATION |
| WhatsApp Cloud API | `token`, `phoneNumberId`, `to` | não testado |
| Signal | `number`, `to` (signal-cli) | desabilitado |
| Gmail | `user` + `appPassword` | conta habilitada; login IMAP real **authenticationFailed** |
| Outlook | `user` + `appPassword` | não configurado |
| Agenda ICS | `icsUrl` | não testado |

- `JARVIS_MAIL_TRANSPORT` ausente mantém o envio de e-mail em **mock**; nenhuma mensagem real foi
  enviada nesta auditoria.
- Para e-mail real via IMAP: corrigir a senha de app/permissão, definir
  `JARVIS_MAIL_TRANSPORT=imap`, testar leitura e só depois habilitar envio com aprovação humana.
- Para Telegram: gerar novo token no @BotFather, atualizar no painel e validar `getMe`; não envie
  mensagens a terceiros sem autorização.

## AgentMail (integração server-side)

AgentMail usa REST v0 e webhook Svix no backend (`server/agentmail.js`). Configure a integração
`agentmail` em **Configurações → Integrações**, incluindo API key e inbox. Segredos ficam na
configuração global cifrada; as variáveis `AGENTMAIL_API_KEY`, `AGENTMAIL_WEBHOOK_SECRET` e
`AGENTMAIL_INBOX_ID` são fallback operacional no container e não devem ser versionadas.

- A inbox configurada deve ser reivindicada uma única vez por um administrador em
  **Configurações → Integrações → Reivindicar inbox AgentMail**. A ação exige confirmação e cria
  ownership imutável para o admin autenticado. A migração v14 não reivindica recursos legados.
- Sem ownership, status não revela o identificador da inbox; eventos ficam ocultos e leitura, registro
  de webhook e ferramentas de agente falham fechados. Depois de reivindicar, eventos/metadados e
  leitura sob demanda ficam limitados ao proprietário.
- Webhook registra somente metadados de envelope e usa assinatura Svix; o corpo não é persistido.
  Envio de agentes requer aprovação humana D9 e é cancelado se inbox ou conteúdo mudarem antes da
  aprovação.
- O MCP remoto `https://mcp.agentmail.to/mcp`, se configurado diretamente em `.mcp.json` ou
  `opencode.json`, é independente e não herda ownership, aprovação D9 nem auditoria do Jarvis.
  Prefira as ferramentas integradas do Jarvis para preservar esses controles.

O estado implantado e a pendência de reivindicação desta instalação estão em
[`HOMOLOGACAO_STATUS.md`](../HOMOLOGACAO_STATUS.md) e [`INTEGRACOES-LAYTECH.md`](../INTEGRACOES-LAYTECH.md).

## Voz

- Motor: Web Speech API (navegador), XTTS-v2/Kokoro local via `xtts-service`, ou ElevenLabs.
- Voz clonada: amostra de 10–60 s; arquivos em `data/voices/`.
- A ponte `scripts/voice-adapter.mjs` traduz `/tts` para o serviço local. Sem `xtts-service`, o
  painel usa o fallback do navegador.

## Bots e autonomia

Gatilhos: horário, intervalo, arquivo alterado, mensagem recebida e comando de voz. Autonomia:
*Pedir confirmação* (padrão), *Só ações seguras* (allowlist) ou *Autônomo total* (exceto comandos
destrutivos). O limite de passos é 1–50. Toda execução é auditada.

# Configuração

Tudo é configurado no painel (**Configurações**) e salvo cifrado em `data/jarvis.db`.

## Proveniência dos valores

A aba **Proveniência** mostra, para cada caminho efetivo de configuração, de onde o valor vem
(`GET /api/settings/provenance`, `settings:read`):

- **padrão** — valor de fábrica (`PERSONAL_DEFAULTS`/`GLOBAL_DEFAULTS`), nada gravado;
- **pessoal** — gravado no registro pessoal **deste** administrador (`admin_settings`);
- **global** — política da instalação (`host`, `integrations`, `voice.localVoiceUrl`), que um
  administrador sem `allowGlobal` não altera.

Regras de exposição (servidor nunca devolve valores):

- segredos (`apiKey`, `token`, ...) aparecem **apenas** como marca `secret` — nem mascarados;
- variáveis de ambiente sensíveis (`JARVIS_MASTER_KEY`, `JARVIS_SERVICE_TOKEN`, `JARVIS_DATA_DIR`,
  `JARVIS_URL`) aparecem só como **definida/não definida**, com "valor não exibido";
- as demais variáveis permitidas na allowlist (`NODE_ENV`, `JARVIS_HOST`, `JARVIS_PORT`,
  `JARVIS_COOKIE_SECURE`, `JARVIS_ALLOWED_ORIGINS`, `JARVIS_MAX_UPLOAD`, `JARVIS_MAX_DOCUMENT`,
  `JARVIS_MAIL_TRANSPORT`, `JARVIS_NO_LISTEN`) aparecem com o valor.

Limite honesto: o inventário cobre o **formato efetivo do servidor**. Campos que o painel completa
com o catálogo local quando o registro não os guarda (ex.: outros campos de um provedor parcial)
não têm caminho efetivo e por isso não são listados — a origem deles é o catálogo do painel, não um
valor gravado.

## Provedores de IA
| Provedor | URL base padrão | Chave |
|---|---|---|
| Ollama | `http://localhost:11434/v1` | não |
| Anthropic | `https://api.anthropic.com` | console.anthropic.com |
| OpenAI | `https://api.openai.com/v1` | platform.openai.com |
| HuggingFace | `https://router.huggingface.co/v1` | huggingface.co/settings/tokens |
| Omniroute | `http://localhost:20128/v1` | painel do Omniroute |
| OpenCode Go | `https://opencode.ai/zen/v1` | opencode.ai |
| OpenRouter / Groq / Gemini | compatíveis com OpenAI | sites dos provedores |
| OpenWebUI | `http://localhost:3000/api` | OpenWebUI → Configurações → Conta → Chave de API |
| Headroom (proxy local) | `http://127.0.0.1:8787/v1` | token do proxy (`HEADROOM_PROXY_TOKEN`) |
| Compatível com OpenAI | qualquer `/v1` | opcional |

O raciocínio do modelo (quando o provedor o devolve) aparece em **Raciocínio** na conversa.

## Ferramentas de integração (agentes)
Além das ferramentas nativas, o agente pode chamar serviços locais:

| Ferramenta | Serviço | Parâmetros |
|---|---|---|
| `context7_docs` | Context7 MCP (`http://127.0.0.1:8000/mcp`) | `library`, `topic` |
| `crawl_page` | crawl4ai (`http://127.0.0.1:11235`) | `url` |
| `openhands_task` | OpenHands (`http://127.0.0.1:8085`) | `task` |

Habilite-as em **Agentes → Ferramentas** e configure as URLs/chaves em **Configurações → Integrações**.

## Integrações de agentes
- **CLI** (Claude Code, Codex, OpenCode, Hermes): o comando usa `{prompt}` como marcador. Ex.: `claude -p {prompt} --output-format text`. O CLI precisa estar instalado e logado.
- **HTTP** (OpenClaw, Odysseus, OpenWebUI, Headroom, OpenHands, crawl4ai): informe a URL compatível com OpenAI; use como provedor “Compatível com OpenAI” num agente.
- **MCP** (Context7): informe a URL do servidor MCP (`http://127.0.0.1:8000/mcp`); o agente usa a ferramenta `context7_docs`.
- **Claude Desktop (MCP)**: em `claude_desktop_config.json`:
  ```json
  { "mcpServers": { "jarvis": { "command": "node", "args": ["C:/jarvis/server/mcp.js"],
      "env": { "JARVIS_SERVICE_TOKEN": "jst_..." } } } }
  ```
  Crie o token em **Configurações → Segurança → Tokens de serviço**, marcando só os escopos necessários (ex.: `chat`, `memories:read`). Ele aparece uma vez e pode ser revogado a qualquer momento. Tokens nunca aprovam ações no host.
  O mesmo servidor MCP serve para Claude Code (`claude mcp add jarvis node /caminho/server/mcp.js`), Codex e OpenCode.

## Comunicação
| Canal | O que preencher |
|---|---|
| Telegram | Crie um bot com @BotFather (`botToken`) e envie uma mensagem a ele; `chatId` aparece em `https://api.telegram.org/bot<TOKEN>/getUpdates`. O Jarvis responde mensagens desse chat. |
| WhatsApp | Meta for Developers → WhatsApp Cloud API: `token`, `phoneNumberId`, `to` (número com DDI). |
| Signal | Instale e registre o [signal-cli](https://github.com/AsamK/signal-cli); `number` (seu) e `to`. |
| Gmail | Ative verificação em 2 etapas e crie uma **senha de app**; `user` + `appPassword`. |
| Outlook | `user` + senha de app (conta Microsoft → Segurança). |
| Agenda | URL ICS secreta (Google Agenda → Configurações → Endereço secreto em formato iCal; Outlook → Publicar calendário). |

## Voz e ativação
- **Palmas duplas**: ajuste a sensibilidade e use **Testar palmas** (8 s).
- **Chamar pelo nome**: diga o nome do assistente (Geral → Nome do assistente).
- **Atalho**: `Ctrl+Shift+J` com o painel em foco.
- **Motor de voz**: navegador, Kokoro (local), XTTS-v2 (voz clonada local) ou ElevenLabs.
- **Voz clonada**: 10–60 s de fala limpa; com XTTS a amostra fica só em `data/voices/`.

## Bots autônomos
| Gatilho | Valor |
|---|---|
| Diariamente às | `08:00` |
| A cada (minutos) | `30` |
| Comando de voz | frase, ex.: `modo reunião` |
| Arquivo alterado | caminho de pasta ou arquivo |
| Mensagem recebida | palavra que deve aparecer na mensagem do Telegram |

Autonomia: *Pedir confirmação*, *Só ações seguras* (lista permitida) ou *Autônomo total*. Limite de passos: 1–50.

## 1. Segurança e Criptografia

• ENCRYPTION_KEY: Esta é a variável mais importante. Ela cifra as senhas de e-mail e chaves de API armazenadas no banco SQLite. Se você perder essa chave, o assistente não conseguirá descriptografar seus tokens antigos.
• BOT_AUTONOMY_LEVEL: Controla os três níveis de autonomia descritos no guia de arquitetura. O valor padrão 1 garante que nenhum script do host rode sem o seu comando direto.

## 2. Provedores de IA (DEFAULT_AI_PROVIDER)

• Se definido como ollama, o assistente funcionará inteiramente sem internet, consumindo os modelos baixados na sua própria máquina.
• Se mudar para openai ou anthropic, certifique-se de colar a respectiva chave de API nos campos abaixo dela.

## 3. Canais de Comunicação

• TELEGRAM_ALLOWED_CHAT_IDS: Uma lista separada por vírgulas contendo os IDs numéricos das contas permitidas a conversar com o seu assistente. Isso impede que terceiros adicionem o seu bot no Telegram e executem comandos na sua máquina.
• EMAIL_PASSWORD: Para provedores como o Gmail, você não deve usar sua senha real de login, mas sim uma Senha de Aplicativo gerada dentro das configurações de segurança da sua conta Google.

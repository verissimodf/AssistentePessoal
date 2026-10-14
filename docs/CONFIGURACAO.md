# Configuração

Tudo é configurado no painel (**Configurações**) e salvo cifrado em `data/jarvis.db`.

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
  { "mcpServers": { "jarvis": { "command": "node", "args": ["C:/jarvis/server/mcp.js"] } } }
  ```
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

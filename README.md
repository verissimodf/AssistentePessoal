# 🤖 AssistentePessoal (J.A.R.V.I.S.)

![Status](https://shields.io)
![License](https://shields.io)
![Node Version](https://shields.io)
![Python Version](https://shields.io)

---

O **AssistentePessoal** é um ecossistema de inteligência artificial de código aberto inspirado no **J.A.R.V.I.S.**, projetado para rodar **100% localmente no seu computador** (Windows ou Linux). Combinando um painel web dinâmico, avatar 3D animado e agentes autônomos, o projeto oferece uma experiência imersiva de automação residencial e desktop sem comprometer sua privacidade.

> 🔒 **Privacidade por Padrão:** Nenhum dado é enviado para a nuvem sem o seu consentimento. Suas memórias, históricos e chaves de API ficam armazenados localmente em um banco SQLite e protegidos por criptografia robusta **AES-256-GCM**.

---

## O que tem

| Recurso | Como |
|---|---|
| Conversa por texto e voz | Painel em `http://localhost:8080`, microfone, resposta falada |
| Ativação | Palmas duplas (calibráveis), chamar pelo nome ("Jarvis"), `Ctrl+Shift+J`, apertar para falar |
| Voz clonada | Envio de `.wav/.mp3/.ogg/.flac/.m4a`; XTTS-v2 local ou ElevenLabs |
| Avatar 3D | Núcleo holográfico (three.js) que reage ao ouvir, pensar e falar |
| Provedores de IA | Ollama, Anthropic, OpenAI, HuggingFace, Omniroute, OpenCode Go, OpenRouter, Groq, Gemini, OpenWebUI, qualquer compatível com OpenAI |
| Agentes externos | Claude Code, Codex, OpenCode, Hermes Agent (CLI); OpenClaw, Odysseus, OpenWebUI (HTTP); Claude Desktop (MCP) |
| Memória | Fatos e notas com busca semântica (embeddings do Ollama/OpenAI) |
| Agentes | Instruções, modelo, ferramentas e biblioteca de modelos de instruções |
| Bots autônomos | Gatilhos: horário diário, intervalo, arquivo alterado, mensagem recebida, frase de voz; 3 níveis de autonomia |
| Ações no host | Comandos com lista permitida, aprovação no painel e log de auditoria |
| Comunicação | Gmail, Outlook (IMAP/SMTP), agenda (ICS), Telegram, WhatsApp Cloud API, Signal (signal-cli) |
| Pesquisa | DuckDuckGo sem chave + leitura de páginas |
| Idiomas | Português, English, Español |

---

## Integrações (stack local LayTech)

O serviço local integra-se a ferramentas que rodam **na mesma máquina**. As URLs e chaves são
configuradas no painel (**Configurações**) e guardadas cifradas em `data/jarvis.db`.

| Integração | Endereço padrão | Ferramenta de agente | O que faz |
|---|---|---|---|
| Ollama (`ollama-llm`) | `http://127.0.0.1:11434/v1` | — (provedor) | chat e embeddings locais |
| Omniroute | `http://127.0.0.1:20128/v1` | — (provedor) | roteamento multi-provedor |
| Hermes Agent | `http://127.0.0.1:8642/v1` | — (provedor) | agente Hermes (OpenAI-compatível) |
| Headroom | `http://127.0.0.1:8787/v1` | — (provedor) | proxy OpenAI com compactação de contexto |
| Context7 (MCP) | `http://127.0.0.1:8000/mcp` | `context7_docs` | documentação atualizada de bibliotecas |
| crawl4ai | `http://127.0.0.1:11235` | `crawl_page` | extração de páginas (inclusive JS) |
| OpenHands | `http://127.0.0.1:8085` | `openhands_task` | agente autônomo de código |
| OpenClaw | `http://127.0.0.1:18789/v1` | `cli_agent`/HTTP | exige `gateway.trustedProxies` no gateway |
| Odysseus | `http://127.0.0.1:7000` | — (HTTP) | app web com login |

Também há agentes de CLI (`claude`, `codex`, `opencode`, `hermes`) via `cli_agent`, com `{prompt}`
como marcador. Detalhes de instalação/validação local em [`INTEGRACOES-LAYTECH.md`](INTEGRACOES-LAYTECH.md).

## Acesso pela rede privada (Tailscale)

O serviço e o painel escutam em loopback. Para acessar de outro dispositivo do tailnet, o script
`scripts/tailnet-proxy.mjs` publica as portas **7777** (API) e **8090** (painel) no IP Tailscale do
host — sem expor na LAN e sem `sudo`. Abra `http://<IP-tailscale>:8090`; o painel detecta o serviço
sozinho. A origem do tailnet é adicionada automaticamente a `JARVIS_ALLOWED_ORIGINS`.

---

## Requisitos

- **Node.js 22.13+** (usa o SQLite embutido do Node, sem compilação nativa). Testado também no 24.
- Windows 10/11 ou Linux (macOS também funciona)
- Navegador Chrome/Edge para reconhecimento de voz
- Opcional: [Ollama](https://ollama.com) para IA 100% offline (`ollama pull llama3.1` e `ollama pull nomic-embed-text`)
- Opcional, só para voz local/clonada: **Python 3.10, 3.11 ou 3.12** — o `kokoro` exige `<3.13`,
  então 3.13 e 3.14 **não** servem

## Instalação rápida

**Windows**
```cmd
scripts\instalar.cmd
scripts\jarvis.cmd
```

**Linux**
```bash
./scripts/instalar.sh
./scripts/jarvis.sh
```

O navegador abre em `http://localhost:8080`. O painel encontra o serviço local
(`http://127.0.0.1:7777`) sozinho — o indicador no canto fica verde: **Conectado ao Jarvis local**.

Passo a passo detalhado, com os comandos de verificação de cada etapa:
[docs/INSTALACAO.md](docs/INSTALACAO.md).

Voz local e clonada (opcional): `scripts\instalar-voz.cmd` ou `./scripts/instalar-voz.sh`.
Instale um Python 3.10–3.12 **antes** — veja a [seção 5 da instalação](docs/INSTALACAO.md).

## Conferir se subiu

```cmd
curl http://127.0.0.1:7777/api/health
```
Resposta esperada: `{"ok":true,"version":"1.0.0","name":"Jarvis","platform":"win32"}`.

Se o painel mostrar **Modo demonstração**, o serviço local não está no ar — veja
[docs/SOLUCAO-DE-PROBLEMAS.md](docs/SOLUCAO-DE-PROBLEMAS.md).

## 🚀 Execução em Segundo Plano (Modo Silencioso)

O projeto possui scripts nativos para rodar o ecossistema (Core, Painel Web e Inteligência de Voz) de forma **100% invisível em background**, sem deixar janelas de terminal abertas poluindo sua área de trabalho.

### 🪟 No Windows

*   **Para iniciar:** Navegue até a pasta do projeto e dê um duplo clique no arquivo:
    ```text
    scripts/jarvis.cmd
    ```
    *Os serviços subirão de forma oculta e, após 6 segundos, a interface web será aberta automaticamente no seu navegador padrão.*

*   **Para encerrar:** Quando quiser desligar o assistente e liberar a memória do computador, dê um duplo clique em:
    ```text
    scripts/stop_jarvis.cmd
    ```
---
### 🐧 No Linux (Ubuntu, Debian, Fedora, etc.)

Antes da primeira execução, garanta que os scripts possuem permissão do sistema operacional rodando o comando abaixo no terminal:
```bash
chmod +x scripts/jarvis.sh scripts/stop_jarvis.sh
```

*   **Para iniciar:** Execute o inicializador a partir da raiz do repositório:
    ```bash
    ./scripts/jarvis.sh
    ```
    *O terminal será liberado imediatamente e você poderá fechá-lo. O J.A.R.V.I.S. continuará rodando como um serviço invisível (daemon).*

*   **Para encerrar:** Execute o script de parada para limpar os processos da memória de forma segura:
    ```bash
    ./scripts/stop_jarvis.sh
    ```
---

### 💡 Inicialização Automática com o Sistema
Se você deseja que o assistente ligue sozinho assim que você ligar o computador (sem precisar clicar nos scripts manualmente), siga o nosso detalhado [Guia de Configuração de Boot (Systemd/Startup)](docs/ARQUITETURA.md#5-guia-de-configuração-inicialização-automática-boot).

## Estrutura

```text
src/        painel web (React + TanStack + Tailwind)
server/     serviço local: API, banco, agentes, ferramentas, bots, voz, MCP
scripts/    instalar, iniciar e testar (Windows .cmd / Linux .sh) + serviço de voz Python
docs/       arquitetura, instalação, configuração, implantação, ajustes, problemas, validação
tests/      testes do serviço local (src/test tem os do painel)
data/       criado na instalação; seus dados (no .gitignore)
```

## Documentação

- [Instalação](docs/INSTALACAO.md) · [Configuração](docs/CONFIGURACAO.md) · [Arquitetura](docs/ARQUITETURA.md)
- [Implantação](docs/IMPLANTACAO.md) · [Ajustes](docs/AJUSTES.md) · [Solução de problemas](docs/SOLUCAO-DE-PROBLEMAS.md) · [Validação](docs/VALIDACAO.md)

## Segurança

Ações no host vêm **desligadas**. Leia [SECURITY.md](SECURITY.md) antes de ligar a autonomia total.

O serviço local escuta só em `127.0.0.1` e recusa origens que não sejam `localhost`/`127.0.0.1`.
Em modo `dev` o painel pode ser anunciado em endereços da sua rede (LAN, Tailscale, WSL) pelo
Vite — para expor só o localhost, rode o painel em produção:
`npm run build` e `npm run preview -- --port 8080`.

## Licença

Apache 2.0 — veja [LICENSE](LICENSE).

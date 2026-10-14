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

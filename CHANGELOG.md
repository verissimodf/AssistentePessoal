# Changelog

## [1.0.1] — 2026-10-13
### Corrigido
- `scripts/instalar-voz.cmd` e `instalar-voz.sh`: a seleção do Python procurava só pelo launcher
  (`where py`) e, quando nenhum 3.10–3.12 estava instalado, caía no `python` do PATH — em geral
  3.13/3.14, onde o `kokoro` (`requires_python <3.13`) não instala. A `.venv` era criada e o
  `pip install` falhava no fim. Agora procuram 3.11, 3.12 e 3.10 explicitamente, abortam com
  mensagem clara se não acharem e propagam erro em cada etapa.

### Documentação
- Faixa de Python da voz corrigida de 3.10–3.11 para **3.10–3.12** (o limite vem do `kokoro`).
- Instalação: comandos de verificação por etapa (`npx vitest run`, `/api/health`), nota de que o
  `npm install` fica silencioso, recomendação de caminho de instalação e nota sobre Pythons do uv.
- Validação: resultado real em Windows 11 com Node 24 (7/7 e 6/6) e a exposição de rede do painel
  em modo `dev`.
- Implantação: exemplo completo de NSSM e de atalho em `shell:startup`; URLs apontando para este
  repositório.

## [1.0.0] — 2026-10-13
### Adicionado
- Painel web com conversa, avatar 3D, memória, agentes, bots e configurações (PT/EN/ES).
- Serviço local Node.js (`server/`) com SQLite embutido e chaves cifradas.
- Provedores: Ollama, Anthropic, OpenAI, HuggingFace, Omniroute, OpenCode Go, OpenRouter, Groq, Gemini, OpenWebUI, compatível com OpenAI.
- Integrações: Claude Code, Codex, OpenCode, Hermes, OpenClaw, Odysseus, OpenWebUI, servidor MCP para Claude Desktop.
- Voz: navegador, Kokoro local, XTTS-v2 com voz clonada, ElevenLabs.
- Ativação por palmas duplas, nome do agente, atalho e apertar para falar.
- Bots autônomos com agenda, intervalo, arquivo, mensagem e frase de voz.
- Gmail/Outlook (IMAP/SMTP), agenda ICS, Telegram, WhatsApp, Signal.
- Scripts de instalação para Windows e Linux; CI em Ubuntu e Windows.

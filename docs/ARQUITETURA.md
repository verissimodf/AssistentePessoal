# Arquitetura

```text
Navegador ── http://localhost:8080 (painel)
   │  detecta automaticamente
   ▼
http://127.0.0.1:7777 (server/index.js)
   ├─ settings.js   chaves cifradas AES-256-GCM
   ├─ db.js         SQLite embutido (node:sqlite) em data/
   ├─ llm.js        provedores + laço de ferramentas do agente + embeddings
   ├─ tools.js      pesquisa, memória, comandos, CLIs, mensagens, e-mail, agenda
   ├─ hostpolicy.js regras de segurança dos comandos
   ├─ bots.js       agendador, observador de arquivos, gatilhos de texto
   ├─ comms.js      Telegram, WhatsApp, Signal, IMAP/SMTP, ICS
   ├─ voice.js      TTS e clonagem ──► scripts/voz/voice_service.py (127.0.0.1:7778)
   └─ mcp.js        servidor MCP (stdio) para Claude Desktop/Code, Codex, OpenCode
```

**Integração painel ↔ serviço**: o painel testa `http://localhost:7777/api/health` a cada 10 s.
Se responder, tudo passa a usar o serviço local; se não, entra em modo demonstração (dados em
`localStorage`). Não há token para parear: o serviço só escuta em localhost e só aceita origens
`localhost`/`127.0.0.1` (configure outras em `JARVIS_ALLOWED_ORIGINS`).

## API
| Método | Rota | Função |
|---|---|---|
| GET | `/api/health` | estado |
| GET/PUT | `/api/settings` | configurações (segredos mascarados) |
| POST | `/api/providers/:id/test` | testa provedor |
| POST | `/api/chat` | conversa com o agente ativo |
| POST | `/api/approvals/:id` | aprova/nega comando |
| CRUD | `/api/memories`, `/api/agents`, `/api/bots` | dados |
| POST | `/api/bots/:id/run`, GET `/api/bots/:id/runs` | execuções |
| POST | `/api/tts`, `/api/voice/clone` | voz |

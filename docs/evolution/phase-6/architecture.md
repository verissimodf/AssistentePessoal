# Arquitetura Multimodal (Fase 6)

## Posição na arquitetura

O motor multimodal (`server/multimodal.js`) é uma **camada de entrada e apresentação** —
não um segundo cérebro. Toda a inteligência, autorização, memória e persistência de
conversa permanecem exatamente onde estavam nas Fases 0–5:

```
┌────────────────────────────────────────────────────────────┐
│ Multimodal Studio (src/routes/multimodal.tsx)              │
│  mic (MediaRecorder) · upload · texto · avatar · eventos   │
└───────────────┬────────────────────────────────────────────┘
                │ HTTP (cookie + CSRF) — mesmas regras do painel
┌───────────────▼────────────────────────────────────────────┐
│ Rotas /api/mm/* (server/index.js)                          │
│  acesso "chat" (sessões/turnos) e "voice" (áudio)          │
└───────────────┬────────────────────────────────────────────┘
┌───────────────▼────────────────────────────────────────────┐
│ Multimodal Engine (server/multimodal.js)                   │
│  mm_sessions · mm_turns · mm_events                        │
│  turn states · interrupção (AbortController) · latência    │
└──────┬─────────────────────────────┬───────────────────────┘
       │                             │
┌──────▼──────────┐        ┌─────────▼──────────────────────┐
│ STT (stt.js)    │        │ chatExchange (conversations.js) │
│ whisper.cpp     │        │  → runAgent / ferramentas /     │
│ local, único    │        │    Policy Engine / D9           │
└─────────────────┘        └─────────┬──────────────────────┘
                                     │ resposta textual
                           ┌─────────▼──────────────────────┐
                           │ TTS (voice.js)                  │
                           │  xtts/kokoro local ou ElevenLabs│
                           └─────────────────────────────────┘
```

## Decisões estruturais (resumo; detalhes em decisions.md)

- **ADR-MM-001** — Camada de apresentação sobre `chatExchange`: sem backend duplicado,
  sem histórico paralelo, sem segunda memória.
- **ADR-MM-002** — Reuso dos motores STT/TTS existentes com injeção para testes
  (`setVoiceFetch`, `fetchFn`), nunca novos provedores acoplados.
- **ADR-MM-003** — Nenhum áudio bruto persistido no servidor; transcrição + metadados.
- **ADR-MM-004** — Eventos tipados por polling (`GET /api/mm/events?sinceId=`) usando a
  infraestrutura HTTP existente; sem WebSocket novo.
- **ADR-MM-005** — Escopos reutilizados (`chat`, `voice`); nenhum escopo novo.
- **ADR-MM-006** — Avatar puro no cliente (SVG/CSS), dirigido pelo estado real da sessão.

## Fronteira de confiança

- O corpo do serviço de STT/TTS é **dado não confiável**: textos transcritos são
  sanitizeados (`stt.js` remove caracteres de controle), limitados a 12.000 caracteres e
  tratados apenas como mensagem candidata.
- Uma transcrição que contenha instruções ("ignore as regras…", "aprovar…") é somente
  texto dentro da conversa — não altera escopos, não aprova, não executa.
- Ferramentas chamadas durante um turno multimodal passam pelo mesmo `callTool`
  (revalidação de escopo na execução) e D9 de sempre.

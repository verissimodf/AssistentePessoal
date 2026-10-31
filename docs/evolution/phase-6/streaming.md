# Streaming e Transporte de Eventos (Fase 6)

## Base operacional existente

- **NDJSON streaming**: `/api/chat/stream` já transmite eventos ao vivo (reflex, progresso
  de ferramentas, `final`) com cabeçalhos anti-buffer (`x-accel-buffering: no`).
- **Polling HTTP**: o painel já opera por requisições HTTP autenticadas (cookie + CSRF).

## Decisão (ADR-MM-004)

Os eventos multimodais são expostos por **polling incremental** —
`GET /api/mm/events?sessionId=…&sinceId=…` — sobre a infraestrutura HTTP existente.
Não há WebSocket no stack (nem nas Fases 0–5); criar um segundo transporte só para esta
fase violaria a regra de não criar infraestrutura paralela.

## Eventos tipados (§8.1)

| Evento | Emitido quando |
|---|---|
| `session.started` | sessão aberta |
| `audio.capture.started` | usuário iniciou captura explicitamente |
| `audio.capture.stopped` | usuário parou a captura |
| `transcription.completed` | STT devolveu texto (ou correção manual aplicada) |
| `response.started` | envio confirmado — processamento iniciou |
| `response.text.delta` | **não emitido**: o run do modelo não tokeniza em deltas (limitação honesta; ver limitations.md) |
| `response.audio.delta` | **não emitido**: o TTS devolve o áudio completo |
| `response.completed` | resposta persistida no histórico da conversa |
| `response.speaking` | síntese da resposta iniciou |
| `response.interrupted` | interrupção pelo usuário ou fechamento/timeout |
| `session.error` | falha de STT/TTS/geração/timeout/recovery, com `scope` e `code` |

Os nomes seguem a semântica do mandato; os dois eventos de delta permanecem definidos no
contrato para compatibilidade futura e são declarados como não emitidos.

## Cancelamento, concorrência e eventos atrasados (§8.2)

- cancelamento de geração: guarda de obsolescência em `sendTurn`;
- cancelamento de TTS: `AbortController` real (fetch abortado);
- interrupção de reprodução: cliente para o `<audio>` + `POST /interrupt`;
- descarte de eventos obsoletos: turnos têm estado persistido; eventos carregam
  `turn_id` — o cliente ignora eventos de turnos não ativos;
- sessões/streams não vivem para sempre: timeout de turno (5 min), expiração de sessão
  (2 h) e teto de 500 eventos por sessão.

## Latência instrumentada (§8.3)

`mm_turns.latency_json`: `transcription_ms`, `generation_ms`, `tts_ms` — valores
**observados**, registrados por turno e exibidos no Studio. Nenhuma meta numérica é
declarada como alcançada.

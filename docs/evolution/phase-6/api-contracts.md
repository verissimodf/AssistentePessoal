# Contratos de API — Multimodal (Fase 6)

Todas as rotas exigem sessão verificada (cookie `jarvis_sid`) + CSRF (`x-jarvis-csrf`)
em mutações. Acesso declarado por rota (choke point em `server/index.js`):
`chat` para sessões/turnos (mesma superfície do chat) e `voice` para áudio.
Erros seguem o envelope padrão do serviço `{ error: code }` com HTTP semântico.

## Sessões

| Método | Rota | Acesso | Corpo | Resposta |
|---|---|---|---|---|
| GET | `/api/mm/sessions?limit=` | `chat` | — | lista de sessões do dono |
| POST | `/api/mm/sessions` | `chat` | `{ conversationId, modalities? }` | sessão completa (turnos + eventos) |
| GET | `/api/mm/sessions/:id` | `chat` | — | sessão + turnos + eventos (404 uniforme) |
| POST | `/api/mm/sessions/:id/close` | `chat` | — | `{ ok, interruptedTurns }` |

Erros: `mm_conversation_required` (400), `mm_session_not_active` (409),
`not_found` (404).

## Turnos

| Método | Rota | Acesso | Corpo / multipart | Resposta |
|---|---|---|---|---|
| POST | `/api/mm/sessions/:id/capture/start` | `voice` | — | turno `listening` |
| POST | `/api/mm/turns/:id/capture/stop` | `voice` | — | turno `idle` |
| POST | `/api/mm/sessions/:id/audio` | `voice` | multipart `file`, `language` | turno `transcribing` com transcrição |
| POST | `/api/mm/sessions/:id/text` | `chat` | `{ message }` | turno `idle` com texto pronto |
| POST | `/api/mm/turns/:id/transcript` | `voice` | `{ text }` | turno com transcrição corrigida |
| POST | `/api/mm/turns/:id/send` | `chat` | — | turno `completed` + `output_text` + latência |
| POST | `/api/mm/turns/:id/speak` | `voice` | — | áudio binário (`__raw`/`__type`) + turno |
| POST | `/api/mm/turns/:id/interrupt` | `chat` | — | turno `interrupted` |

Erros de turno: `mm_turn_concurrent` (409), `mm_turn_limit` (429),
`mm_turn_not_listening` / `mm_turn_not_editable` / `mm_turn_not_sendable` /
`mm_turn_not_speakable` / `mm_turn_not_interruptible` (409),
`mm_transcript_required` (400), `mm_session_not_active` (409).

## Eventos

| Método | Rota | Acesso | Query | Resposta |
|---|---|---|---|---|
| GET | `/api/mm/events` | `chat` | `sessionId`, `sinceId`, `limit` | eventos novos (ou `null` → 404 se não for do dono) |

## Reuso (sem novas rotas)

- `POST /api/tts`, `POST /api/stt` — sintetizar/transcrever fora de uma sessão.
- `GET/POST /api/conversations`, `POST /api/chat` — superfície de conversa original.

## Status codes

201/200 sucesso; 400 validação; 401/403 authn/authz (deny-by-default); 404 uniforme
(inexistente ou de outro dono); 409 estado; 413 upload; 429 limites; 502/503 provedor.

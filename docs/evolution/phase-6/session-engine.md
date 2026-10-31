# Motor de Sessões Multimodais (`server/multimodal.js`)

## Contratos

| Contrato | Onde vive |
|---|---|
| MultimodalSession | tabela `mm_sessions` + `getSession()` |
| ConversationTurn | tabela `mm_turns` (`turnView`) |
| ModalityInput | `input_kind` do turno (`text`, `audio`, `upload`) |
| ModalityOutput | `output_text` + `audio_meta_json` |
| TranscriptSegment | `transcript_json` (texto, segmentos, idioma, engine, `corrected`) |
| SpeechEvent | tabela `mm_events` (kinds tipados) |
| VoiceProfile | `admin_settings.voice` (existente — não duplicado) |
| AvatarState | derivado no cliente a partir do estado do turno (`src/lib/multimodal-ui.ts`) |
| ModalityEvent | `mm_events.kind` + `payload_json` |
| MediaArtifact | **não persistido**: áudio sintetizado volta na resposta HTTP; metadados ficam no turno |

## Sessão

- `openSession(adminId, { conversationId, modalities })` — exige conversa **do próprio
  dono** (`conversations.admin_id`); cria linha em `mm_sessions` + `ownership`
  (`resource_type='mm_session'`); emite `session.started`.
- Modalidades declaradas: `text`, `audio_in`, `audio_out`, `transcript`, `image`, `avatar`
  — a indisponibilidade de uma modalidade não impede as demais (fallback textual integral).
- `closeSession` interrompe todos os turnos ativos e encerra a captura no cliente.
- Sessões ociosas além de `MM_LIMITS.max_session_runtime_ms` (2 h) são fechadas pelo tick.

## Turnos

Estados (CHECK no banco, §7.1 do mandato):
`idle → listening → transcribing → processing → generating → speaking → completed`
com desvios `interrupted` e `failed`.

- Um turno ativo por sessão (`mm_turn_concurrent`).
- `mm_turns.conversation_id` aponta para a MESMA conversa da sessão — nenhum histórico
  duplicado; a troca é gravada por `chatExchange` em `conversation_messages`.
- `latency_json` registra observações reais: `transcription_ms`, `generation_ms`, `tts_ms`.

## Eventos

`mm_events` por sessão com teto de retenção (`MM_LIMITS.max_events_per_session = 500`;
o excedente mais antigo é removido a cada inserção). Kinds:
`session.started`, `audio.capture.started`, `audio.capture.stopped`,
`transcription.completed`, `response.started`, `response.completed`,
`response.speaking`, `response.interrupted`, `session.error`.

## Recuperação

- `recoverMmTurns()` (boot): turnos em estado transitório após reinício do serviço falham
  com `mm_interrupted_boot` — nunca ficam "presos para sempre".
- `tickMmSessions()` (60 s): turnos travados além de `max_turn_runtime_ms` (5 min) falham
  com `mm_turn_timeout`; sessões ociosas expiram.
- Ambos auditam sem conteúdo (`mm.turns_recovered`, `mm.session_expired`).

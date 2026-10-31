# Persistência e Migração v25 (Fase 6)

## Migração

- `server/migrations.js` → `version: 25` — "multimodal experience: sessions, turns,
  typed events and transcript segments".
- Padrão inviolado: backup verificado + transação única + verificação de linhas
  preservadas (`expect` inclui `ownership` recriada com o novo tipo `mm_session`).
- Testada em banco legado v0 (upgrades de todas as versões), banco limpo e idempotência
  (segunda execução não faz nada e não cria backup novo).

## Tabelas criadas

### `mm_sessions`
Sessão multimodal de um admin sobre UMA conversa existente:
`id, owner_admin_id, conversation_id, status(active|closed|failed), modalities_json,
state_json, created_at, updated_at, closed_at`.

### `mm_turns`
Turno conversacional multimodal:
`id, session_id (CASCADE), conversation_id, seq, state(9 estados em CHECK),
input_kind(text|audio|upload), input_text, transcript_json, reply_message_id,
output_text, audio_meta_json, error_code, latency_json, created_at, updated_at`.

### `mm_events`
Eventos tipados por sessão (teto 500, corte automático):
`id (autoincrement), session_id (CASCADE), turn_id, kind, payload_json, created_at`.

### `ownership`
Recriada com `mm_session` nos tipos permitidos (linhas preservadas 1:1; trigger de
imutabilidade recriado).

## Decisões de persistência

- **Nenhum binário no banco**: áudio nunca é persistido (ADR-MM-003); apenas metadados.
- **Histórico não duplicado**: as mensagens vivem em `conversation_messages`; `mm_turns`
  referencia (`reply_message_id`, `conversation_id`) — é um índice de experiência, não
  uma cópia.
- **Avatar state não é persistido**: derivado do estado real dos turnos no cliente.
- **Preferências de voz não duplicadas**: `admin_settings.voice` existente é a fonte.

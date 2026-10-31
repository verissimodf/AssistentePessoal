# Retenção, Armazenamento e Exclusão (Fase 6)

## Política por tipo de dado

| Dado | Onde | Retenção | Exclusão |
|---|---|---|---|
| Áudio bruto (capturado) | **não persistido** — só em memória do cliente durante a sessão | n/a | encerradas as tracks no fechamento |
| Áudio bruto (upload) | em trânsito multipart → memória do processo STT | n/a | fim da requisição |
| Áudio sintetizado (TTS) | resposta HTTP, não gravada | n/a | fim da requisição |
| Transcrição | `mm_turns.transcript_json` | vida do turno | exclusão da sessão/conversa (dono) |
| Metadados de áudio | `mm_turns.audio_meta_json` (`type`, `bytes`, `tts_ms`) | vida do turno | idem |
| Eventos | `mm_events` | últimos 500 por sessão | corte automático a cada inserção |
| Turnos | `mm_turns` | ≤ 200 por sessão (`mm_turn_limit`) | cascata com a sessão |
| Sessões | `mm_sessions` | fecha após 2 h de ociosidade (tick) | status `closed`, dados preservados para auditoria do dono |
| Latência | `mm_turns.latency_json` | vida do turno | idem |

## Garantias (§14)

- **Ownership**: `mm_sessions` registrada em `ownership` (`resource_type='mm_session'`);
  todas as operações filtram pelo dono.
- **Integridade referencial**: FKs declaradas (`mm_sessions.conversation_id →
  conversations`, `mm_turns.session_id → mm_sessions` com `ON DELETE CASCADE`).
- **Idempotência**: o envio reutiliza a idempotência de `chatExchange` (`client_msg_id`).
- **Auditoria**: `mm.session_opened/closed/expired`, `mm.turns_recovered` — sem conteúdo.
- **Exclusão consistente**: apagar a conversa remove as mensagens; os turnos multimodais
  mantêm apenas texto/metadados (sem órfãos de áudio, que nunca existiram).
- **Limites de armazenamento**: teto de eventos, de turnos, de caracteres de transcrição
  (16.000) e de sessões ativas por tempo — nada cresce sem limite.
- **Nada em diretórios públicos**: nenhum artefato multimodal é escrito em disco.

# Operação (Fase 6)

## Habilitando a experiência multimodal

1. **Painel**: aba "Multimodal" (Multimodal Studio). Sem configuração obrigatória —
   texto funciona sempre.
2. **STT (fala → texto)**: serviço whisper.cpp local (container `stt`, ver
   `scripts/stt-entrypoint.sh`). Se estiver fora do ar, a modalidade de voz aparece
   **explicitamente indisponível**; texto e upload continuam funcionando.
3. **TTS (texto → fala)**: adaptador de voz local (`scripts/instalar-voz.sh`, porta
   7778) ou ElevenLabs (opt-in, chave própria). Estados `warming_up`/`busy` são
   normais no primeiro uso (cold-start do XTTS ~40 s).

## Variáveis de ambiente relevantes

| Variável | Padrão | Função |
|---|---|---|
| `JARVIS_STT_URL` | `http://stt:8080` | serviço whisper.cpp |
| `JARVIS_TTS_TIMEOUT_MS` | 20000 | timeout morno do TTS |
| `JARVIS_TTS_COLD_START_MS` | 120000 | timeout de cold-start do TTS |
| `JARVIS_MAX_UPLOAD` | 25 MB | teto de upload (áudio incluído) |

## Limites operacionais do motor

- 200 turnos por sessão; 500 eventos por sessão (corte automático);
- transcrição ≤ 16.000 caracteres; áudio ≤ 15 MB e 12 req/min por admin;
- turno transitório expira em 5 min (`mm_turn_timeout`); sessão ociosa fecha em 2 h.

## Diagnóstico

- `/api/diagnostics` — inventário operacional (sem sondas externas).
- `/api/health` — versão do schema (v25) e do build.
- Auditoria: `mm.session_opened`, `mm.session_closed`, `mm.session_expired`,
  `mm.turns_recovered` — sempre sem conteúdo.
- Logs nunca registram corpo de requisições, transcrições ou áudio.

## Rotinas

- **Reinício do serviço**: `recoverMmTurns()` falha explicitamente turnos órfãos
  (`mm_interrupted_boot`) — nenhuma ação manual.
- **Conversa excluída**: as mensagens somem com a conversa (fluxo existente); turnos
  multimodais mantêm texto/metadados do turno.
- **Nada a limpar em disco**: a fase não grava artefatos de áudio em lugar nenhum.

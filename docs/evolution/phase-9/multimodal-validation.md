# Validação Multimodal — Fase 9

Reavaliação da Fase 6 (Multimodal Experience) na consolidação, com a classificação
final de cada capacidade.

## STT (whisper.cpp) — PENDENTE DE INFRAESTRUTURA

- A **cadeia completa está implementada e testada com fixture** (`tests/stt.test.mjs`;
  demo-final-acceptance com STT fixture/interrupção).
- O serviço whisper.cpp **não está em execução no ambiente** de consolidação — a
  plataforma trata isso com **indisponibilidade explícita** (código estável e mensagem
  clara), nunca simulando sucesso.
- Para ativar: subir o serviço STT no ambiente de destino (ver
  [runbook.md](runbook.md) e [limitations.md](limitations.md)).

## TTS (xtts) — RESOLVIDO E COMPROVADO

Síntese **real** comprovada na Fase 6, com medições registradas:

| Medição | Valor |
|---|---|
| Amostra gerada | 347 KB WAV |
| Latência aquecida | ~13,9 s |
| Latência fria (CPU) | ~110 s |

`tests/voice-tts.test.mjs` cobre o adaptador; nada mudou na F9.

## Interrupção de turnos — PASS

Turnos podem ser interrompidos e o estado é recuperável — coberto por
`tests/multimodal.test.mjs` e pelo passo multimodal da demo-final-acceptance
(STT fixture + interrupção).

## Avatar — HONESTO, SEM LIP-SYNC

- Animação **por estado** (ouvindo/pensando/falando) — verdadeira sobre o que o
  sistema faz.
- **Sem lip-sync**: decisão de design declarada na F6 e mantida — o sistema não finge
  sincronia fonética que não existe.

## Privacidade

**Sem áudio persistido**: turnos registram eventos de estado e transcrições quando
disponíveis, mas o áudio em si não é gravado no banco nem no FS — invariantes da F6
mantidas e reauditadas na F9.

## Mudanças estruturais da F9 no módulo

- `server/stt.js` deixou de lançar `MailError` e passou a ter `SttError` própria
  (mesmos códigos estáveis) — erros de STT agora têm semântica própria no choke point.
- `TURN_STATES` (dead code) removido.
- Índices v28 em `mm_sessions(status, updated_at)` e `mm_turns(state, updated_at)`
  para os ticks de sessões.

## Veredicto

| Capacidade | Veredicto |
|---|---|
| Sessões/turnos/eventos | PASS |
| TTS | PASS (real, comprovado) |
| Interrupção | PASS |
| Avatar honesto | PASS (decisão declarada) |
| STT | PARTIAL — código PASS, runtime pendente de infraestrutura |

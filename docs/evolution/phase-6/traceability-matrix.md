# Matriz de Rastreabilidade (Fase 6)

Requisito do mandato → implementação → teste.

| # | Requisito (mandato) | Implementação | Teste | Estado |
|---|---|---|---|---|
| 1 | Gate Fase 5 (§2) | verificação de repo/remote/commit `832450f`/docs/execução antes do início | — (procedural) | ✅ Aprovado |
| 2 | F6.1 Motor de sessão multimodal sem duplicar histórico (§4) | `server/multimodal.js` + migração v25 + `chatExchange` | tests/multimodal.test.mjs 1-3, 14 | ✅ |
| 3 | Contratos tipados de sessão/turno/evento (§4.1) | tabelas `mm_sessions/mm_turns/mm_events` com CHECK; `turnView`; `MODALITIES` | teste 1; migrações | ✅ |
| 4 | Modalidades com tratamento próprio; indisponibilidade não bloqueia demais (§4.2) | códigos estáveis por modalidade; fallback textual integral | testes 7, 8-10; 16 de UI | ✅ |
| 5 | Captura de áudio explícita + validação sem confiar em extensão (§5.1) | `startCapture`/`stopCapture`; `stt.js` (MIME, assinatura, tamanho, rate) | testes 2, 23 | ✅ |
| 6 | Interface de STT substituível; sem inventar precisão (§5.2) | reuso `transcribeAudio` (whisper.cpp local); `fetchFn` injetável | testes 4-6, 7 | ✅ |
| 7 | Transcrição: visualizar/corrigir/enviar/cancelar (§5.3) | `transcript_json` + `attachTranscript` + envio explícito | testes 4-6, 22; UI Studio | ✅ |
| 8 | Reconhecimento ≠ autorização (§5.3, §7.3, §12.4) | transcrição é texto; Policy Engine/D9 no `chatExchange` | testes 21, 18 da demo | ✅ |
| 9 | TTS substituível, pt-BR, sem alterar conteúdo (§6) | reuso `voice.js` (xtts local REAL verificado; ElevenLabs opt-in) | testes 8-10; demo passo 8 | ✅ |
| 10 | Reprodução: iniciar/interromper; sem sobreposição (§6.3) | `<audio>` no Studio; `interruptTurn` com AbortController; 1 turno/sessão | testes 11-12, 14 | ✅ |
| 11 | Estados de turno reais (§7.1) | CHECK de 9 estados em `mm_turns` | testes 1-3, 13, 15 | ✅ |
| 12 | VAD — não tratar ruído como comando (§7.2) | controle explícito + gate de envio (ADR-MM-007) | testes 21, 22 | ✅ |
| 13 | Contexto compartilhado entre modalidades (§7.4) | `mm_turns.conversation_id` → `conversation_messages` | testes 1-3, 13; demo 14 | ✅ |
| 14 | Eventos tipados (§8.1) | `mm_events` com kinds do contrato | teste 25 | ✅ |
| 15 | Cancelamento, obsolescência, sem sessão eterna (§8.2) | guarda de obsolescência; timeouts; teto de eventos | testes 13, 15, 17-20 | ✅ |
| 16 | Latência observada, sem metas inventadas (§8.3) | `latency_json` (transcription/generation/tts_ms) | testes 1-3, 4-6, 8-10 | ✅ |
| 17 | Avatar com estados coerentes (§9) | `Avatar.tsx` + `avatarStateFromTurn` | 16 testes de UI | ✅ |
| 18 | Sem dependências gráficas pesadas; fallback estático (§9.4-9.5) | SVG/CSS puro; `prefers-reduced-motion` | testes de UI | ✅ |
| 19 | Integração chat (§10.1) | o Studio opera sobre `/api/conversations`+`chatExchange` | testes 1-3; UI | ✅ |
| 20 | Integração Workforce/Research/Learning/Computer (§10) | voz via chat; ferramentas e D9 existentes intocados | regressão 807 backend | ✅ |
| 21 | Memória: distinções preservadas; áudio não vira memória (§11) | `mm_turns` não escreve em `memories` | testes 1-3, 21 | ✅ |
| 22 | Sem captura oculta; indicador visível (§12.1) | getUserMedia no clique; badge `aria-live` | UI Studio | ✅ |
| 23 | Retenção/exclusão consistentes (§12.2) | sem áudio persistido; teto de eventos; expiração | testes 8-10, 20; demo 16 | ✅ |
| 24 | Credenciais nunca em logs/frontend (§12.3) | nenhuma chave nova; STT local sem chave | revisão de diff | ✅ |
| 25 | Multimodal Studio funcional (§13) | `src/routes/multimodal.tsx` + bridge + nav | 16 testes de UI; build | ✅ |
| 26 | i18n pt/en/es (§13) | 55 chaves `mm.*` | build; padrão existente | ✅ |
| 27 | Migração v25 com upgrade/limpo/idempotente (§14) | `server/migrations.js` | suíte de migrações (807) | ✅ |
| 28 | Regressão Fases 0-5 (§15.6, §19) | suíte integral sem alterar testes anteriores | 807/807 backend, 148/148 frontend | ✅ |
| 29 | Demo de aceite (§16) | `scripts/demo-fase6.mjs` | 18 passos (testing.md) | ✅ |
| 30 | Documentação completa (§17) | 26 documentos em `docs/evolution/phase-6/` | link check | ✅ |
| 31 | Sem push/PR/merge/deploy (§3, §20) | commit local apenas | estado do git | ✅ |

## Pendências conscientes (declaradas, não ocultas)

- `transcription.partial`, `response.text.delta`, `response.audio.delta`: definidos no
  contrato, **não emitidos** (limitações honestas — limitations.md).
- VAD automático: não implementado (ADR-MM-007 — controle explícito + gate de envio).
- Câmera/vídeo e imagem como entrada: fora do escopo desta fase.

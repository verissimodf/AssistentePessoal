# Requisitos → Evidências — Fase 9

Matriz de rastreabilidade entre os critérios de aceite das fases 6, 7 e 8 (reavaliados
na consolidação) e os objetivos da F9. Evidências: arquivos de teste, demos
(`scripts/demo-fase6.mjs`, `demo-fase7.mjs`, `demo-fase8.mjs`,
`demo-final-acceptance.mjs`) e documentos das fases.

## Fase 6 — Multimodal Experience

| Requisito | Evidência | Estado |
|---|---|---|
| Sessões/turnos/eventos versionados | migração v25; `tests/multimodal.test.mjs`; índices v28 (`mm_sessions`, `mm_turns`) | PASS |
| STT (whisper.cpp) com indisponibilidade explícita | `tests/stt.test.mjs` (fixture); serviço não em execução no ambiente | PASS (código) / PENDENTE DE INFRAESTRUTURA (runtime) |
| TTS xtts real | síntese real medida na F6: 347 KB WAV, 13,9 s aquecido / ~110 s frio (CPU); `tests/voice-tts.test.mjs` | PASS — RESOLVIDO E COMPROVADO |
| Interrupção de turno | `tests/multimodal.test.mjs`; demo-final-acceptance (passo multimodal) | PASS |
| Avatar honesto (animação por estado, sem lip-sync) | F6 `docs/evolution/phase-6/avatar-experience.md` | PASS (decisão declarada) |
| Sem áudio persistido | por design; auditado na F6/F9 | PASS |

## Fase 7 — Proactive Intelligence

| Requisito | Evidência | Estado |
|---|---|---|
| Regras versionadas com justificativa e evidências | migração v26; `tests/proactive.test.mjs` | PASS |
| Níveis 0–3 de agressividade | `tests/proactive.test.mjs`; demo-fase7 | PASS |
| Oportunidade → aceite → workflow (nunca auto-executar) | demo-final-acceptance: regra→evento→oportunidade→aceite→workflow | PASS |
| Notificações internas | v26; índice `pr_notifications(owner,read_at)` na v28 | PASS |
| Cooldown correto entre regras irmãs do mesmo evento | **BUG da F8 corrigido na F9**; regressão nº 36 em `tests/integrations.test.mjs` | PASS (após correção F9) |

## Fase 8 — Integration Fabric

| Requisito | Evidência | Estado |
|---|---|---|
| Webhook ingress autenticado (HMAC-SHA256, segredo 1×, replay) | rota pública asserida em `tests/http-auth.test.mjs`; `tests/integrations.test.mjs` | PASS |
| Contrato canônico de eventos | v27; `docs/evolution/phase-8/event-normalization.md` | PASS |
| Calendar provider abstrato (`fixture` / `google`) | `tests/integrations.test.mjs`; demo-final-acceptance (calendário fixture) | PASS (fixture) / PENDENTE DE CREDENCIAL (google) |
| Timezone IANA + DST + recorrências | demo-final-acceptance (timezone/recorrência); `docs/evolution/phase-8/temporal-intelligence.md` | PASS |
| Proativo como único motor de disparo | demo-fase8 20/20 | PASS |

## Fase 9 — Consolidação (objetivos próprios)

| Objetivo | Evidência | Estado |
|---|---|---|
| Auditoria arquitetural integral | [architecture-audit.md](architecture-audit.md) | PASS |
| Zero ciclos estáticos | ciclo `bots.js`↔`jobs.js` corrigido (`setBotRunner`, FIRST-WINS) | PASS |
| Duplicações consolidadas | `parseJson`/`clean` em `server/util.js`; regressão 848/848 | PASS |
| Contrato de erro coerente no STT | `SttError` própria (mesmos códigos) | PASS |
| Bug funcional corrigido | `recordExternalEvent` avalia todas as regras; teste nº 36 | PASS |
| Índices para ticks periódicos | migração v28 aditiva (12 índices) | PASS |
| Dead code removido | `TURN_STATES`, `treeVerification`, 28 componentes UI, 25 deps | PASS |
| Suíte integral verde | backend 848/848; frontend 195/195; eval 6/6; tsc 0; eslint 0 | PASS |
| Demo de aceite final integrada | `demo-final-acceptance.mjs` 37/37 | PASS |
| Documentação final + parecer | esta série (24 docs) + [../README.md](../README.md) | PASS |

## Critérios sem PASS integral

Os itens PARTIAL/PENDENTE estão enumerados com classificação §16 em
[limitations.md](limitations.md): STT (pendente de infraestrutura), Google Calendar
(pendente de credencial), escrita no calendário (decisão do operador, D9 futura),
webhook outbound (fora de escopo), `khSearch` multi-donor (risco operacional baixo),
lip-sync do avatar (decisão de design honesta).

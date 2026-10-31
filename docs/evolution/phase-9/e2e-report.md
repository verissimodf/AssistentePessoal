# Relatório E2E — Fase 9

## Demo de aceite final: `scripts/demo-final-acceptance.mjs`

**Resultado: 37/37 passos verdes.** É um cenário integrado de ponta a ponta que
exercita a plataforma como um operador real a usaria — com **serviços reais** sempre
que possível e **fixtures declaradas** onde a infraestrutura externa não existe no
ambiente.

## Discriminação: serviços reais vs fixtures

### Serviços REAIS exercitados

| Serviço | Cenário da demo |
|---|---|
| Auth + sessões | autenticação real (login, escopos) |
| Ownership | isolamento cross-owner verificado em **todos** os módulos |
| Workflow Engine | fluxo real com `REQUIRE_APPROVAL` |
| Policy Engine + D9 | aprovação **real** via `resolveApproval` + fingerprint válido |
| Proactive Engine | regra→evento→oportunidade→aceite→workflow |
| Webhook HMAC | aceito (assinatura válida) e rejeitado (inválida) |
| Auditoria | trilha completa, **sem segredos**, 0 execuções não autorizadas |
| Recuperações de boot | runs/aprovações interrompidas recuperadas |
| KH | ingest + busca **FTS5 real** |
| Timezone/DST | recorrências e conflitos com dados determinísticos |

### FIXTURES declaradas (explicitadas no output da demo)

| Fixture | Substitui | Motivo |
|---|---|---|
| embeddings | modelo de embeddings | sem modelo local no ambiente |
| busca | busca web externa | sem acesso externo |
| one-shot | execução KH one-shot | idem |
| agentRunner | execução de agente | determinismo do cenário |
| worker UDS | browser worker | sem browser real no cenário |
| STT | serviço whisper.cpp | serviço não em execução no ambiente |
| TTS | síntese de voz | TTS real já comprovado na F6 (347 KB WAV); fixture para determinismo |
| calendário | provider de calendário | `fixture` marcado `provider_test_only`; Google pendente de credencial |

## Sequência de cenários (37 passos)

1. **Contexto**: autenticação real e criação de conversa (passos 1–4).
2. **Knowledge Hub**: ingest + busca FTS5 real.
3. **Research**: execução com fixture de busca **declarada**.
4. **Workforce**: delegação com orçamento.
5. **Workflow real**: fluxo com D9 **real** — `resolveApproval` + fingerprint válido
   (passos ~15–16: aprovação e conclusão do run).
6. **Proativo**: criação de regra nível 2 → evento → oportunidade com justificativa →
   aceite → workflow (passos ~18+).
7. **Integrações**: webhook HMAC aceito e rejeitado.
8. **Calendário**: provider fixture + timezone/recorrência.
9. **Computer Intelligence**: observe em browser isolado UDS (worker fake declarado).
10. **Multimodal**: sessão com STT fixture + interrupção.
11. **Fecho**: notificações, recuperações de boot, auditoria sem segredos, isolamento
    cross-owner em todos os módulos, **0 execuções não autorizadas**.

## Demos das fases anteriores (regressão)

| Demo | Resultado |
|---|---|
| `scripts/demo-fase8.mjs` | **20/20** |
| `scripts/demo-fase6.mjs`, `demo-fase7.mjs` | aprovadas nas respectivas fases; cenários centrais re-exercitados pela demo final |

## O que a demo NÃO cobre

- **OAuth real do Google Calendar** (requer credencial do operador).
- **STT/TTS em runtime real** neste ambiente (STT pendente de infraestrutura; TTS
  comprovado na F6).
- Verificação de imagem da F9 — executar **após o commit**
  (instruções em [build-image-report.md](build-image-report.md)).

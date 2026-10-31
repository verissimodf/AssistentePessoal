# Arquitetura Geral e Auditoria de Reuso (Fase 7)

## Matriz de auditoria arquitetural (§5)

| Capacidade | Implementação existente | Reutilização | Lacuna (resolvida nesta fase) |
|---|---|---|---|
| Agendamento | fila durável `durable_jobs` (bots) com lease/recuperação; `next_run_at` calculável | `next_run_at` persistido + `tickProactive` (padrão de tick das Fases 3/5/6) | gatilhos temporais para regras (não bots) |
| Gatilhos de eventos | `wf_events` (workflow), estados das Fases 4/5/6; sem barramento | **sink** mínimo em `workflow.js` (`setWfEventSink`) com inversão de dependência | registro em `pr_events` + matching de regras |
| Condições | `evaluatePolicies` (Policy Engine, para política) | motor próprio `evaluateConditions` para FATOS de eventos (domínio distinto; sem eval) | avaliação determinística fail-closed |
| Execução de workflows | `startWorkflowRun` (políticas + idempotência + orçamento) | **total** — nenhuma execução fora dele | disparo por regra/oportunidade |
| Aprovação humana | D9 nativo do Workflow Engine (`approval` node + `tickWfRuns`) | **total** | correlação oportunidade→approval (trail) |
| Notificações | inexistente para o painel | nova tabela `pr_notifications` interna (sem canal externo) | camada interna completa |
| Auditoria | `audit()` central (db.js) | **total** — eventos `pr.*` | — |
| Recuperação | `recover*` + ticks por fase | padrão repetido: `recoverProactive` + `tickProactive` | reconciliação oportunidade↔run |

**Nada duplicado**: sem terceira fila (regras usam estados persistentes + tick), sem
segundo scheduler (um interval `tickProactive` no boot), sem novo sistema de autorização
(Policy Engine/D9 intocados).

## Diagrama

```
fontes internas ──► pr_events (dedupe) ──► regras ativas (match gatilho)
   (workflow sink,                       │
    temporal via tick,                       ▼
    manual pelo admin)               condições (fail-closed)
                                        │
                       nível 0: registra e para
                       nível 1: oportunidade 'recommended' ──► humano aceita/ignora/adia
                       nível 2/3: regra 'auto' ──► startWorkflowRun
                                        │
                        Workflow Engine (políticas + D9 nativos)
                                        │
                     wf_run terminal ──► tick reconcilia oportunidade
                                        └──► notificações internas + auditoria + trail
```

## Integrações (§12) — todas via contratos existentes

- **Workflow Engine**: início (`startWorkflowRun`), reconciliação (estados do run),
  sink de eventos (`setWfEventSink` — adição mínima com inversão de dependência).
- **Workforce**: workflows podem delegar (nós `agent`), com orçamento da Fase 1 intacto;
  o motor proativo não concede escopos.
- **Knowledge Hub / Deep Research / Learning / Computer / Multimodal**: fontes de eventos
  registradas na whitelist (`SOURCES`); nenhuma dependência circular (eventos entram por
  `recordEvent`, chamado por quem tem a informação).

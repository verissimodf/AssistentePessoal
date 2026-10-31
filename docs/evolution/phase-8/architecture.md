# Arquitetura do Integration Fabric (Fase 8)

## Auditoria arquitetural (§5) e decisões de reuso

| Capacidade | Componente existente | Decisão |
|---|---|---|
| Eventos internos | `pr_events` + `recordEvent` (Fase 7) | **Reutilizar** — fabric apenas registra (fontes `integrations`/`calendar`) |
| Normalização | inexistente | **Estender** — `normalizeExternalEvent` com contrato canônico |
| Jobs e retries | fila durável `durable_jobs` (lease/idempotência/recuperação) | **Reutilizar** (padrão); eventos do fabric aceitos duravelmente e processados no tick |
| Execução | Workflow Engine (`startWorkflowRun`) | **Reutilizar** — única porta de execução |
| Autorização | Policy Engine + D9 | **Preservar integralmente** |
| Auditoria | `audit()` central | **Reutilizar** (`if.*`) |
| Credenciais | `secret-crypto` (AES-256-GCM) + `oauth_connections` | **Não duplicar** — segredos de produtores cifrados com o mesmo mecanismo |
| Agendamento | Proactive Engine (`next_run_at` + tick) | **Estender** — timezone IANA, recorrências, janelas (§10) |

Sem terceira fila, sem segundo scheduler, sem novo banco, sem novo mecanismo de
autorização, sem proxy arbitrário.

## Diagrama

```
produtor externo ──► POST /api/if/webhooks/:producerId   (rota PÚBLICA)
                        │ HMAC-SHA256 (segredo cifrado) + janela de tempo + rate limit
                        ▼
                 if_events (aceitação DURÁVEL, idempotency_key UNIQUE) ──► 202
                        │ [tick 15 s — processamento assíncrono]
                        ▼
                 normalizeExternalEvent (contrato canônico; payload = dado)
                        ▼
                 Proactive Engine (recordEvent: source 'integrations')
                        ▼
                 regra → condições → oportunidade → Workflow Engine → Policy/D9

CalendarProvider (fixture | google) ── sync incremental (cursor) ──► cal_events
                        │                                              │ dedupe/conflitos
                        └── recordEvent (source 'calendar') ───────────┴──► Proactive Engine
```

## Componentes novos (e o que cada um NÃO é)

- `server/integrations.js` — registro + produtores + ingress + normalização. NÃO é motor
  de execução.
- `server/calendar.js` — abstração de calendário. NÃO é sincronismo em background novo
  (sync sob demanda/tick).
- Extensões mínimas: `proactive.js` (fontes `integrations`/`calendar`; timezone IANA nos
  gatilhos; drift/janela), `index.js` (rotas + boot), `migrations.js` (v27).

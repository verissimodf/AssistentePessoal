# Observabilidade (Fase 8, §16)

## Métricas reais (contagens do banco — nada inventado)

| Métrica | Fonte |
|---|---|
| integrações configuradas/ativas | `if_integrations` por status |
| falhas de conexão | `if_integrations.last_error` + health checks (`/test`) |
| eventos recebidos | `if_events` (total) |
| eventos autenticados | `trust_level = 'authenticated'` (todos aceitos) |
| eventos rejeitados | `error_code` preenchido + `if.webhook_rejected` (audit) |
| eventos duplicados | replays (audit `if.webhook_rejected` não marca; dedupe devolve 200 — visível por idempotência) |
| eventos normalizados/encaminhados | `status = 'forwarded'` |
| sincronizações executadas | `cal_accounts.last_sync_at` + audit `if.calendar_synced` |
| conflitos encontrados | `cal_conflicts` (abertos/resolvidos) |
| recorrências processadas | `tickProactive` → `temporalFired` + oportunidades `kind='temporal_due'` |
| ocorrências atrasadas | audit `pr.occurrence_skipped` (`pr_occurrence_stale`) |
| retries | fila durável existente (`durable_jobs.attempts`) — eventos do fabric não reprocessam (idempotência) |
| falhas permanentes | oportunidades `failed` com `decision_json.error` |
| execuções iniciadas/concluídas | `pr_metrics` (Fase 7): workflows_started/executions_completed |

## Correlação completa

`integration_id → producer_id → event_id (if_events) → rule_id → opportunity_id →
workflow_run_id → approval_id → resultado` — consultável via
`GET /api/pr/opportunities/:id/trail` (Fase 7) e no Event Inspector do Studio.

## Privacidade

Auditoria e logs registram ids/estados/códigos estáveis — NUNCA payload, segredos,
tokens ou conteúdo de eventos.

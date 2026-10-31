# Observabilidade (Fase 7, §16)

## Métricas reais (`GET /api/pr/metrics`)

Contagens diretas do banco — nenhum valor inventado:

`events_received` · `opportunities_produced` · `opportunities_accepted` ·
`workflows_started` · `executions_completed` · `executions_failed` ·
`duplicates_blocked` (eventos com dedupe key) · `rules_active` ·
`notifications_unread`.

Eventos descartados (tempestade), bloqueios por política e cancelamentos aparecem via
audit (`pr_event_storm` rejeitado com 429) e oportunidades `failed` com
`decision_json.error` (ex.: `wf_policy_denied`).

## Correlação completa (`GET /api/pr/opportunities/:id/trail`)

```
event_id → rule_id (+ rule_version) → opportunity_id → workflow_run_id →
  approvals[] (approval_id, node, estado) → resultado (status da oportunidade)
```

Tempo de processamento: medido no motor (durações dos ticks e das execuções de
workflow são do Workflow Engine); a demo registra valores observados.

## Auditoria

`pr.rule_created`, `pr.rule_updated`, `pr.rule_state`, `pr.opportunity_recommended`,
`pr.opportunity_accepted`, `pr.opportunity_dismissed`, `pr.auto_started`,
`pr.recovered_executing` — sempre com dono/ids/estados, nunca conteúdo.

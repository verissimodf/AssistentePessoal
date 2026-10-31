# Contratos do Motor Proativo (Fase 7)

Contratos tipados (§6.1), todos validados no backend; o frontend nunca decide
autorização, identidade de executor ou permissões.

## ProactiveRule — `pr_rules` (+ `pr_rule_versions`)

```jsonc
{
  "id": "uuid", "owner_admin_id": "…", "name": "…", "description": "…",
  "origin": "user" | "derived",
  "trigger_kind": "event" | "temporal" | "contextual",
  "trigger": { "source": "workflow", "eventKind": "wf_completed" }, // ou temporal
  "conditions": { "all": [ … ] },          // árvore validada (conditions-engine.md)
  "workflow_id": "uuid | null", "params": {},
  "execution": "manual" | "auto",          // 'auto' só age nos níveis ≥ 2
  "valid_from": "…", "valid_until": "…", "max_executions": 10 | null,
  "execution_count": 0, "cooldown_ms": 60000,
  "state": "draft|active|paused|disabled|expired|failed",
  "version": 2, "last_run_at": "…", "next_run_at": "…", "versions": [ … ]
}
```

## TriggerDefinition

- **Event**: `{ source ∈ SOURCES, eventKind }` — fontes whitelist: `workflow, research,
  learning, kh, workforce, mm, computer, manual, system`. Fonte fora → `pr_invalid_source`.
- **Temporal**: `{ type: daily|weekly|interval|date, time?, weekday?, intervalMs?, date? }`.
- **Contextual**: `{ source?, eventKind? }` declarativo (fontes registradas apenas).

## ConditionDefinition — árvore finita, sem eval

`{all: [...]}` (AND) · `{any: [...]}` (OR) · `{not: {...}}` · folha
`{op, fact: "a.b.c", value}` com operadores `eq, ne, gt, gte, lt, lte, contains,
exists, missing, in`. Limites: profundidade ≤ 4, nós ≤ 20; violação é TERMINAL
(fail-closed, não invertível por NOT).

## ProactiveOpportunity — `pr_opportunities`

```jsonc
{
  "id": "…", "rule_id": "…", "event_id": 42, "rule_version": 3, // versão do momento
  "kind": "research_completed | temporal_due | …",
  "priority": "low|normal|high",
  "justification": "por que esta recomendação existe (texto)",
  "evidence": [ { "type": "event", "source": "research", … } ],
  "status": "detected|evaluating|recommended|dismissed|snoozed|accepted|executing|completed|failed|expired",
  "workflow_run_id": "uuid|null", "decision": { "acceptedBy": "…", "at": "…" }
}
```

## ProactiveExecution / ProactiveEvent / ProactiveNotification / ProactiveAuditRecord

- **Execution** não tem tabela própria: é a execução do Workflow Engine
  (`wf_runs`/`wf_node_executions`) correlacionada por `workflow_run_id` — não duplicamos
  execução (ADR PR-001).
- **ProactiveEvent** — `pr_events` (owner, source, kind, payload, dedupe_key UNIQUE).
- **ProactiveNotification** — `pr_notifications` (type, priority, source, entity, title,
  body, read_at, expires_at).
- **ProactiveAuditRecord** — eventos `pr.*` no `audit` central (sem conteúdo sensível) +
  `getExecutionTrail` para a correlação completa
  `event_id → rule_id → opportunity_id → workflow_run_id → approval_id → resultado`.

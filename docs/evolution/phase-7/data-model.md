# Modelo de Dados — Migração v26 (Fase 7)

`server/migrations.js` `version: 26` — "proactive intelligence: versioned rules, internal
events, opportunities and notifications". Padrão inviolado: backup verificado, transação
única, verificação de linhas preservadas, `expect` inclui `ownership` recriada com
`pr_rule`.

## `pr_rules`
Regra proativa de um admin: `id, owner_admin_id, name (UNIQUE por dono), description,
origin(user|derived), trigger_kind(event|temporal|contextual), trigger_json,
conditions_json, workflow_id, params_json, execution(manual|auto), valid_from,
valid_until, max_executions, execution_count, cooldown_ms, state(draft|active|paused|
disabled|expired|failed), version, last_run_at, next_run_at, last_error, timestamps`.

## `pr_rule_versions`
Trilha imutável de versões: `id, rule_id (CASCADE), version (UNIQUE por regra),
snapshot_json (a regra inteira no momento), author_admin_id, created_at`. Uma edição
NUNCA altera versões anteriores nem execuções em curso (a oportunidade registra a
`rule_version` usada).

## `pr_events`
Eventos internos autorizados: `id (auto), owner_admin_id, source (CHECK whitelist),
kind, payload_json, dedupe_key, created_at` com `UNIQUE(owner_admin_id, dedupe_key)` —
a deduplicação é garantida pelo banco (replay não insere). Payload é DADO.

## `pr_opportunities`
`id, owner_admin_id, rule_id, event_id, rule_version, kind, priority(CHECK),
justification, evidence_json, dedupe_key (UNIQUE parcial WHERE NOT NULL), status (CHECK
com os 10 estados do mandato), workflow_run_id, snoozed_until, decision_json,
expires_at, timestamps`. Dedupe por índice único parcial — duplicados são impossíveis
no banco, não apenas na aplicação.

## `pr_notifications`
`id, owner_admin_id, type (CHECK com os 8 tipos do §13), priority, source, entity_type,
entity_id, title, body, read_at, expires_at, created_at`. Retenção: teto de 200/dono
(corte automático).

## `ownership`
Recriada com `pr_rule` nos tipos. Decisão de ownership (ADR PR-005): **regras** são
recurso de `ownership` (top-level, auditável); eventos/oportunidades/notificações são
derivados com `owner_admin_id` NOT NULL e filtro obrigatório no backend — mesmo
isolamento, sem linhas espúrias na tabela canônica.

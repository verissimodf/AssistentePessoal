# Auditoria de Migrações (v1–v28) — Fase 9

## Mecanismo

Toda migração em `server/migrations.js` segue o mesmo contrato, desde a base:

1. Entrada **versionada** (`version`, `name`, `sql`, `expect`) — nunca se edita uma
   migração já liberada; correções são entradas novas.
2. **Backup verificado** do banco antes de aplicar.
3. **Transação única** — ou aplica tudo ou não aplica nada.
4. **Verificação de preservação de linhas** (preserved-row check) após a cópia.
5. Tabelas inexistentes em bancos novos/parciais são puladas sem erro (data copies
   condicionais à existência da tabela-fonte).

## Sequência por fase

| Versões | Fase | Tema |
|---|---|---|
| v1–v19 | Base | Estrutura fundacional (admins, sessões, ownership, settings split, audit, etc.) |
| v20 | F1 — Agent Workforce | Delegação, orçamento de agentes |
| v21 | F2 — Knowledge Hub | `kh_jobs`, FTS5 + cosine, citações |
| v22 | F3 — Workflow Studio | Motor in-process, `REQUIRE_APPROVAL`, políticas |
| v23 | F4 — Research & Learning | Deep research (searxng), aprendizado |
| v24 | F5 — Computer Intelligence | Browser UDS isolado, memória procedural |
| v25 | F6 — Multimodal | Sessões/turnos/eventos |
| v26 | F7 — Proactive | Regras versionadas, oportunidades, notificações |
| v27 | F8 — Integration Fabric | Webhooks (`if_events`), calendário (`cal_*`) |
| **v28** | **F9 — Consolidação** | **Índices para ticks periódicos (aditiva)** |

## Migração v28 (desta fase)

- **Aditiva e reversível**: somente `CREATE INDEX IF NOT EXISTS` — nenhum dado tocado,
  nenhuma coluna alterada, `expect: []`.
- 12 índices: `if_events(status,id)`, `ci_actions(status,approval_id)` parcial,
  `pr_rules(state,trigger_kind,next_run_at)` + `pr_rules(owner,state,trigger_kind)`,
  `wf_runs(status)`, `mm_sessions(status,updated_at)`, `mm_turns(state,updated_at)`,
  `ci_sessions(owner,created_at)`, `pr_opportunities(dedupe_key)` parcial +
  `pr_opportunities(rule_id,status)`, `cal_conflicts(account,resolved)`,
  `pr_notifications(owner,read_at)`.
- Motivação: ticks de 15–60 s das fases 5–8 deixam de fazer full scan (ver
  [performance-report.md](performance-report.md)).

## Testes de banco

| Cenário | Cobertura |
|---|---|
| Banco vazio (fresh) | `tests/migrations.test.mjs` — cadeia completa v1→v28 aplica sem erro |
| Banco legado (com dados) | `tests/migration-v2.test.mjs`, `migration-v7-v8.test.mjs`, `migration-v9.test.mjs`, `migration-assert-v11.test.mjs`, `kh-migration.test.mjs`, `wf-migration.test.mjs`, `workforce-migration.test.mjs` — preserved-row check |
| Reexecução (idempotência) | cláusulas `IF NOT EXISTS` + contrato transacional; reexecutar não duplica nem falha |
| Backup/guardrail | `tests/backup-guardrail.test.mjs` |

## Achados da F9

- Nenhuma migração histórica (v1–v27) foi alterada — regra da F9.
- A v28, ao mudar o plano de queries do Integration Fabric, **expôs** o bug de
  avaliação de regras irmãs da F8 (dependência de ordem); o bug foi corrigido e
  registrado em [architecture-audit.md](architecture-audit.md) §4.

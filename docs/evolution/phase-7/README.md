# Fase 7 — Inteligência Proativa & Automação Pessoal

Branch: `evolution/phase-7-proactive-intelligence-20261030` (base: `acddcc4`, Fase 6).

A Fase 7 evolui o J.A.R.V.I.S. para identificar oportunidades, recomendar ações e iniciar
rotinas de forma **governada**: proatividade não é autonomia irrestrita. Nenhuma execução
nasce no motor proativo — todo workflow inicia pelo Workflow Engine existente
(`startWorkflowRun`), que já avalia Policy Engine e mantém o D9 (aprovação humana com
fingerprint) para operações protegidas.

## Cadeia de responsabilidade

```
Observação → Detecção de condição → Oportunidade → Recomendação →
  [decisão humana OU automação limitada] → Aprovação (D9, se protegida) →
  Execução → Verificação → Registro do resultado
```

## Componentes

| Componente | Onde | Documento |
|---|---|---|
| Regras versionadas | `pr_rules` + `pr_rule_versions` | [rules-versioning.md](rules-versioning.md) |
| Gatilhos temporais | `trigger_kind='temporal'` + `next_run_at` | [temporal-triggers.md](temporal-triggers.md) |
| Gatilhos por eventos | `pr_events` + sink do Workflow Engine | [event-triggers.md](event-triggers.md) |
| Motor de condições | `evaluateConditions` (sem eval, fail-closed) | [conditions-engine.md](conditions-engine.md) |
| Opportunity Engine | `pr_opportunities` com dedupe e justificativa | [opportunity-engine.md](opportunity-engine.md) |
| Níveis de autonomia | `admin_settings.proactive.level` (0–3) | [autonomy-levels.md](autonomy-levels.md) |
| Notificações internas | `pr_notifications` (sem canal externo) | [api-interface.md](api-interface.md) |
| Proactive Studio | `src/routes/proactive.tsx` | [api-interface.md](api-interface.md) |
| Observabilidade | `getMetrics` + `getExecutionTrail` | [observability.md](observability.md) |
| Threat model | — | [security-threat-model.md](security-threat-model.md) |

## Documentos

1. [architecture.md](architecture.md) — arquitetura geral e auditoria de reuso
2. [engine-contracts.md](engine-contracts.md) — contratos do motor proativo
3. [data-model.md](data-model.md) — modelo de dados (migração v26)
4. [temporal-triggers.md](temporal-triggers.md) — gatilhos temporais
5. [event-triggers.md](event-triggers.md) — gatilhos por eventos internos
6. [conditions-engine.md](conditions-engine.md) — motor de condições
7. [rules-versioning.md](rules-versioning.md) — regras e versionamento
8. [opportunity-engine.md](opportunity-engine.md) — oportunidades
9. [autonomy-levels.md](autonomy-levels.md) — níveis de autonomia
10. [workflow-integration.md](workflow-integration.md) — Workflow Engine
11. [workforce-integration.md](workforce-integration.md) — Agent Workforce
12. [kh-integration.md](kh-integration.md) — Knowledge Hub
13. [research-integration.md](research-integration.md) — Deep Research
14. [learning-integration.md](learning-integration.md) — Learning Studio
15. [computer-integration.md](computer-integration.md) — Computer Intelligence
16. [multimodal-integration.md](multimodal-integration.md) — Experiência Multimodal
17. [d9-policy.md](d9-policy.md) — D9 e Policy Engine
18. [security-threat-model.md](security-threat-model.md) — segurança e threat model
19. [privacy-retention.md](privacy-retention.md) — privacidade e retenção
20. [recovery-idempotency.md](recovery-idempotency.md) — recuperação e idempotência
21. [observability.md](observability.md) — observabilidade
22. [api-interface.md](api-interface.md) — API e Proactive Studio
23. [testing.md](testing.md) — testes e evidências
24. [limitations.md](limitations.md) — limitações conhecidas
25. [runbook.md](runbook.md) — runbook operacional
26. [decisions.md](decisions.md) — decisões (ADRs PR-001..007)

## Garantias inegociáveis

1. Nenhum caminho de autorização alternativo: execução só via `startWorkflowRun`
   (Policy Engine + D9 nativos).
2. Aprovação nunca inferida de execução anterior; cada ação protegida exige resolução
   humana corrente na UI de aprovações.
3. Gatilhos automáticos não são consentimento humano.
4. Eventos são dados: payload nunca é instrução (prompt injection testado).
5. Ownership validado no backend em toda leitura/escrita; isolamento cross-owner testado.

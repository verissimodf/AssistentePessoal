# Opportunity Engine (Fase 7, §9)

## Exemplo canônico (implementado na demo de aceite)

1. Uma pesquisa terminou (evento `research_completed`);
2. o resultado foi armazenado no Knowledge Hub;
3. uma regra com gatilho `event` (source `research`) casa com o evento;
4. condições satisfeitas → oportunidade `recommended` com justificativa e evidências;
5. o usuário **aceita** → o workflow correspondente inicia via `startWorkflowRun`
   (políticas normais);
6. o run termina → o tick reconcilia a oportunidade (`completed`/`failed`) e notifica.

## Estados (10, CHECK no banco)

`detected → evaluating → recommended → (accepted → executing → completed | failed)`
com desvios `dismissed`, `snoozed` (volta a recommended no vencimento), `expired`.

## Garantias

- **Deduplicação**: `dedupe_key` com índice único parcial — o mesmo evento/ocorrência
  NUNCA produz duas oportunidades (garantia do banco, testada com replay).
- **Idempotência do aceite**: `idempotencyKey: pr-opp:{id}` no `startWorkflowRun` —
  aceite repetido não cria segundo run.
- **Justificativa obrigatória**: toda recomendação diz por que existe (evento que a
  gerou, condições avaliadas) — inferências NUNCA são apresentadas como fatos
  confirmados; evidências de origem acompanham a oportunidade.
- **Prioridade e validade**: `priority` low/normal/high; `expires_at` + expiração no
  tick (`expired`).
- **Ownership e histórico**: `owner_admin_id` NOT NULL; decisões humanas registradas em
  `decision_json` (quem, quando, motivo do descarte).
- **Vínculo**: `rule_id` + `rule_version` + `event_id` + `workflow_run_id` — a cadeia de
  correlação completa é consultável (`getExecutionTrail`).

## Limites que cercam oportunidades

Teto global pendente por dono (`maxPendingOpportunities`), teto pendente por regra
(5), cooldown, teto horário de execuções por regra, pausa global e por regra, nível 0
não produz oportunidades.

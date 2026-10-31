# Recuperação e Idempotência (Fase 7, §11)

## Fontes de verdade duráveis

- **Regras**: `state`, `next_run_at`, `execution_count`, `last_run_at` — tudo no banco.
  Nenhum timer em memória como fonte de verdade: o único interval do motor
  (`tickProactive`, 30 s) apenas CONSULTA o banco.
- **Eventos**: `pr_events` com `dedupe_key` UNIQUE por dono — duplicidade impossível no
  banco.
- **Oportunidades**: estado persistido; transições atômicas.

## Recuperação após reinício (boot)

1. `recoverProactive()` — audita oportunidades `executing` (nada é "esquecido");
2. `tickProactive()` no primeiro intervalo — reconcilia cada uma com a EVIDÊNCIA do run
   (`wf_runs.status`): completed → `completed`; failed/cancelled → `failed`;
   ainda em curso → aguarda;
3. regras temporais com `next_run_at` vencido durante a queda disparam UMA vez
   (dedupe por minuto de ocorrência) — nenhum agendamento perdido nem duplicado;
4. validade vencida durante a queda → regra `expired`.

## Idempotência de ponta a ponta

- Evento repetido (replay) → `duplicate: true`, sem processamento;
- Ocorrência repetida (tick duplo) → `pr_duplicate`;
- Aceite repetido → `pr_opportunity_not_acceptable` (e o run original sobrevive via
  `idempotencyKey: pr-opp:{id}`);
- Run desconhecido após crash → reconciliado por evidência, nunca repetido cegamente
  (mesmo princípio do `recoverScheduledJobs` da fila de bots).

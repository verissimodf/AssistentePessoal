# Gatilhos Temporais (Fase 7)

## Tipos

| Tipo | Spec | Próxima ocorrência |
|---|---|---|
| `daily` | `{type:"daily", time:"HH:MM"}` | hoje no horário (UTC) ou amanhã |
| `weekly` | `{type:"weekly", time:"HH:MM", weekday:0-6}` | próximo dia da semana no horário |
| `interval` | `{type:"interval", intervalMs: >=60000}` | agora + intervalo |
| `date` | `{type:"date", date:"YYYY-MM-DD", time?}` | uma única vez; depois a regra **expira** |

Validação no backend (`pr_invalid_trigger_*`); `intervalMs < 60000` rejeitado (proteção
contra loops de disparo).

## Funcionamento durável (§11 — nada só em memória)

1. Ao ativar/retomar uma regra temporal, `next_run_at` é **calculado e persistido**.
2. `tickProactive` (30 s, no boot) seleciona regras `active` com `next_run_at <= agora`,
   calcula a PRÓXIMA ocorrência e persiste ANTES de processar efeitos.
3. A ocorrência usa chave idempotente `pr:opp:{ruleId}:tick:{minuto}` — dois ticks no
   mesmo minuto produzem UMA oportunidade (dedupe no banco, testado).
4. Janela de validade: `valid_until` vencido → regra `expired` (transição atômica);
   gatilho `date` expira após a ocorrência única.
5. Recuperação após crash: `next_run_at` sobrevive ao reinício (persistido); o tick
   dispara na janela seguinte — nenhum agendamento perdido ou duplicado.

## Execução do disparo

O vencimento chama `handleRuleTriggered` — o MESMO caminho dos eventos internos:
controles → limites → condições → oportunidade (nível 1) ou início automático
(níveis 2/3 via `startWorkflowRun`). Nenhuma exceção para "ser só uma rotina":
protegidas continuam exigindo D9.

# Regras Proativas e Versionamento (Fase 8↔7, §8)

## Ciclo de vida

```
draft ──activate──► active ──pause──► paused ──resume──► active
  │                   │                    │
  └──disable──► disabled ◄──disable────────┘
                   ▲  │
failed ──► draft/disabled   active ──expired (validade vencida / gatilho date cumprido)
```

Transições com guarda de grafo (`TRANSITIONS`) e verificação atômica; estados inválidos
→ `pr_invalid_transition` (409).

## Campos de governança por regra

- `execution: manual | auto` — 'auto' SÓ age nos níveis de autonomia ≥ 2 (§10);
- `max_executions` — teto total; atingido → regra `disabled` + notificação `limit_reached`;
- `cooldown_ms` — intervalo mínimo entre disparos (throttle de rajada);
- `valid_from` / `valid_until` — janela de validade (vencida → `expired`);
- `next_run_at` — agenda persistida para gatilhos temporais.

## Versionamento

Toda edição (`updateRule`) cria uma **nova versão** com snapshot completo em
`pr_rule_versions` (autor + data). Garantias:

1. Versões anteriores são imutáveis;
2. Execuções em curso não são alteradas retroativamente — cada oportunidade registra a
   `rule_version` do momento do disparo;
3. A trilha responde "qual era a regra quando isso executou".

## Operações

Criar · editar (versão nova) · validar (estática no save + `testRule` dinâmico) ·
ativar · pausar (com notificação `rule_paused`) · retomar · desativar · histórico ·
**teste sem efeitos colaterais** (`POST /rules/:id/test` — avalia condições contra fatos
de amostra e devolve `wouldTrigger/wouldAutoStart` SEM criar oportunidade ou run) ·
**execução manual** (`POST /rules/:id/run` — mesmo caminho e políticas das automáticas).

## Auditoria

`pr.rule_created`, `pr.rule_updated` (com versão), `pr.rule_state` (com estado) — sem
conteúdo das condições no log.

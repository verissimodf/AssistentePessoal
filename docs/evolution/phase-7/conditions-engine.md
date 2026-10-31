# Motor de Condições (Fase 7)

## Requisitos do mandato (§7) → implementação

| Requisito | Implementação |
|---|---|
| Operadores explicitamente permitidos | `COMPARATORS` = eq, ne, gt, gte, lt, lte, contains, exists, missing, in — qualquer outro → falso com razão `unknown_op` |
| Validação de tipos | comparações numéricas exigem number nos dois lados; tipo errado → falso (nunca coerção) |
| AND/OR/NOT | nós `all` / `any` / `not` combináveis em árvore |
| Valores ausentes | `exists`/`missing` explícitos; qualquer outro operador sobre dado ausente → falso com razão |
| Limite de profundidade | 4 níveis (`max_conditions_depth`) |
| Limite de tamanho | 20 nós (`max_conditions_nodes`) |
| Prevenção de avaliação arbitrária | **sem `eval`/`new Function`** (verificado por teste); avaliador é um `switch` fechado |
| Fail-closed | violação de limite é TERMINAL (`checked.violated`): NOTs aninhados não a invertêm (bug detectado e corrigido por teste) |
| Razão registrada | cada falha acumula razão legível (`fact op value`, `too_deep`, `unknown_op:…`) |
| Validação no save | `assertConditionsValid` rejeita estrutura/operador inválidos em criação/edição (`pr_invalid_conditions`) |

## Semântica de vazio

Condições ausentes/vazias = "sempre verdadeiro" (regra dispara em qualquer evento que
case com o gatilho) — decisão explícita, documentada no ADR PR-003.

## Relação com o Policy Engine

O motor de condições avalia **fatos de eventos** para decidir SE uma oportunidade é
relevante. Ele NÃO autoriza nada: a autorização de execução é sempre do Policy Engine
(no início do run) e do D9 (nas ações protegidas). Condição satisfeita ≠ autorização.

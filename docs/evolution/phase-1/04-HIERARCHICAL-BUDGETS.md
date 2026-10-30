# 04 — Orçamento hierárquico

Implementado em `server/workforce.js:325-420`. Toda a contabilidade é no backend, persistida em
`budget_json`/`usage_json` — o modelo nunca é fonte de consumo (contrato 04 §6).

## 1. Dimensões e tetos

`BUDGET_DIMS` (dims contabilizáveis e alocáveis): `workforce.js:46`.

Dimensões: `max_tool_calls`, `max_model_calls`, `max_tokens`, `runtime_ms`.

### `HARD_LIMITS` — tetos absolutos (`workforce.js:21-31`)

| Dim | Teto |
|---|---|
| `max_depth` | 5 |
| `max_children` | 16 |
| `max_tree_runs` | 64 |
| `max_tool_calls` | 200 |
| `max_model_calls` | 400 |
| `max_tokens` | 4.000.000 |
| `runtime_ms` | 600.000 (10 min) |
| `max_retries` | 3 |
| `max_concurrent_children` | 4 |

### `DEFAULT_BUDGET` — quando o definition não declara (`workforce.js:34-44`)

| Dim | Default |
|---|---|
| `max_depth` | 3 |
| `max_children` | 8 |
| `max_tree_runs` | 16 |
| `max_tool_calls` | 25 |
| `max_model_calls` | 40 |
| `max_tokens` | `null` (desconhecido até o provider relatar uso confiável — nunca fabricado, `workforce.js:40`) |
| `runtime_ms` | 300.000 (5 min) |
| `max_retries` | 1 |
| `max_concurrent_children` | 2 |

`clampBudget` (`workforce.js:49-63`) recorta todo orçamento declarado aos tetos; dimensão
inválida (NaN ou ≤0) cai no default.

## 2. Fórmula de alocação do filho

`reservedFor` (`workforce.js:328-343`) + `allocateChildBudget` (`workforce.js:350-420`).

Para cada dim em `BUDGET_DIMS`:

```
remaining = max(0, allocation[pai][dim] − usage[pai][dim] − Σ allocation[fila][dim])
alloc[filho][dim] = want[dim] === null ? remaining : min(want[dim], remaining)
```

- `Σ allocation[fila]` soma **todos** os filhos vivos (qualquer status, incluindo
  `completed`/`failed` — `workforce.js:333`): alocação concedida não é devolvida.
- Se `limit <= 0` em qualquer dim exceto `max_tokens` → `workforce_budget_exhausted`
  (`workforce.js:372`).

### Limites estruturais (não contabilizados por dim)

| Limite | Regra | Recusa | Ref |
|---|---|---|---|
| `max_depth` | o orçamento do pai carrega **níveis restantes**: filho recebe `inherited.max_depth − 1`; pai com `max_depth < 1` é recusado | `workforce_depth_limit` | `workforce.js:355-366,408` |
| `max_children` | `min(pedido, HARD_LIMITS, herdado)`; conta `agent_runs WHERE parent_run_id` | `workforce_child_limit` | `workforce.js:377-385` |
| `max_tree_runs` | idem; conta `agent_runs WHERE correlation_id` | `workforce_tree_limit` | `workforce.js:386-394` |
| `max_concurrent_children` | idem; conta filhos em status ativo (`queued/running/awaiting_approval`) | `workforce_concurrency_limit` | `workforce.js:395-405` |
| `max_retries` | propagado como `min(pedido, HARD, herdado)` — **reservado**, retry não implementado | — | `workforce.js:411-415` |

Delegação **nunca amplia** o orçamento da árvore: cada teto do filho é o mínimo entre pedido,
teto absoluto e o herdado (`workforce.js:375-376`).

## 3. Atomicidade

`allocateChildBudget` roda dentro de `tx` = `BEGIN IMMEDIATE ... COMMIT/ROLLBACK`
(`workforce.js:351`, `ownership.js:62-72`). O somatório `consumido(pai) + alocado(filhos) +
novo ≤ alocado(pai)` é avaliado atomicamente, então delegações concorrentes não excedem o pai —
testado com 4 delegações paralelas (`workforce-core.test.mjs:426-473`).

## 4. Mensagens de recusa tipadas

Mapeadas em `delegate` (`workforce.js:855-868`) — retorno em texto ao modelo:

| Código | Mensagem ao modelo |
|---|---|
| `workforce_budget_exhausted` | "Delegação recusada: orçamento desta execução esgotado." |
| `workforce_child_limit` | "Delegação recusada: limite de especialistas deste run atingido." |
| `workforce_tree_limit` | "Delegação recusada: limite de execuções da árvore atingido." |
| `workforce_concurrency_limit` | "Delegação recusada: limite de especialista simultâneos atingido." |
| `workforce_depth_limit` | "Delegação recusada: profundidade máxima de delegação atingida." |

Na rota HTTP, `workforce_budget_exhausted` num run também marca o run como `failed` com esse
`error_code` (`workforce.js:734-737`).

## 5. Enforce em execução

- `maxSteps` = `min(execution_limits.max_model_calls, allocation.max_model_calls)`; `maxToolCalls`
  e `deadlineMs` análogos (`workforce.js:619-629`).
- Consumo persistido ao fim do run: `tool_calls` do loop, `model_calls` via `onProgress`,
  `estimated_tokens` pela fórmula da telemetria (chars/4) (`workforce.js:630-644`).

## 6. Limitações honestas

| Limitação | Detalhe | Ref |
|---|---|---|
| Tokens são **estimados** | `estimated_tokens = ceil((len(reply) + len(messages)) / 4)` — mesma fórmula da telemetria; não é uso real do provider | `workforce.js:638-644` |
| `max_tokens` não é enforced preventivamente | É contabilizado em `usage_json`, mas nenhuma checagem interrompe o run ao esgotá-lo; na alocação, `max_tokens` esgotado degrada a `remaining` sem recusar (`workforce.js:372`) | `workforce.js:372,638-644` |
| `max_retries` reservado | O executor não implementa retry; o campo só é propagado/limitado no orçamento | `workforce.js:411-415` |
| Alocação do filho não é liberada | Filhos em status final continuam somando em `reservedFor` (`workforce.js:333`) | `workforce.js:333` |

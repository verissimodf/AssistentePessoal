# Integração com o Workflow Engine

Implementada via **registry de extensão** adicionado ao motor da Fase 3
(`server/workflow.js`: `registerNodeType`/`registerNodeExecutor`) — sem alterar o executor
existente nem criar runtime paralelo.

## Nós registrados (`server/computer.js`, `registerCiWorkflowNodes`; chamado no boot do
serviço — `server/index.js`)

| Nó | Config | Execução | Saída |
|---|---|---|---|
| `computer_session` | — | abre sessão de navegador para o objetivo do run (owner do run) | `{session_id}` |
| `computer_observe` | `{session_id}` (aceita `$node.<id>.session_id`) | observação (screenshot + extract) da sessão | `{observation_id, hash, content}` |
| `computer_execute` | `{session_id, plan_id}` | executa o plano (escritas com D9; retomada via tick) | resultado do plano |
| `computer_verify` | `{session_id}` | nova observação + resumo dos estados das ações | `{report}` |

- Interpolação `$node.<id>.<caminho>` resolve a sessão/plan_id criados por nós anteriores
  do MESMO run (resolução local, sem eval).
- Cada executor é envolvido em tratamento que converte falhas em código tipado
  (`ci_node_error:<motivo>`) — a propagação de falha do motor da Fase 3 interrompe o run
  com estado rastreável.
- Idempotência/retomada/reconciliação: **herdadas** (máquina de estados da Fase 3; ações CI
  pendentes de D9 retomam pelo `tickCiSessions`).

## O que NÃO foi feito (honestamente)

- Nós CI dedicados não fazem transporte de sessão ENTRE runs (uma sessão vive no escopo do
  run que a criou) — pipelines multi-run compartilhando sessão ficam para fase posterior
  (ver [`limitations.md`](limitations.md)).

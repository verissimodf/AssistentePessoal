# Motor de execução (`server/workflow.js`)

Executor in-process determinístico sobre estado persistido — sem fila (ADR-WF-001).
Funções-chave: `executeNodeWithState` :565, `runReadyWave` :556, `executeWorkflowRun` :608.

## Fluxo de execução (`executeWorkflowRun`, :608-740)

1. **Admissão** (:610-627): só executa run em `queued`, `waiting_dependency` ou `running`
   (retomada); caso contrário devolve o run como está. Transição para `running` feita por
   `setRunStatus` (CAS por status anterior, :284-303). Grafo ausente → run `failed`
   `wf_definition_missing` (:622-627).
2. **Checkpoint por nó** (:636-643): saídas persistidas (`output_json`) dos nós concluídos são
   recarregadas no mapa `outputs` — retomada nunca re-executa nó `completed`/`skipped`
   (`executeNodeWithState:578-579`).
3. **Laço determinístico** (:648-735): percorre do `start` seguindo arestas; nó `condition`
   escolhe a aresta `when: "true"|"false"` (:704-713); sem aresta seguinte → `completed`.
   Fan-out (>1 aresta) executa a onda em paralelo e segue para o primeiro `end` (:716-726).

## Ondas e paralelismo

- `runReadyWave` (:556-563) fatia os nós prontos em blocos de `MAX_PARALLEL = 2` (:40) e
  executa cada bloco com `Promise.all`.
- Cada nó tem linha própria em `wf_node_executions`; a transição de status é CAS
  (`setNodeStatus`, :305-340): se outro executor venceu a transição, o perdedor trata como
  `waiting` e não duplica efeito (:580-586).

## Interpolação `$node.*`

`resolveValue` (:343-359): strings `"$node.<id>.<caminho...>"` são resolvidas contra a saída
persistida de um nó anterior (percorre o caminho ponto a ponto); objetos e arrays são
resolvidos recursivamente. Usada em `tool` input (:425), `knowledge_search.query` (:447),
`transform.source_ids`/`prompt` (:468-469) e `agent`/`subworkflow.objective` (:495, :518).
Condições usam o mesmo mecanismo em `left`/`right` (`conditionTrue`, :361-378).

## Falha propaga

`executeNodeWithState` captura exceções → nó `failed` com `error_code` (≤60 chars) + evento
`node_failed` (:596-601). No laço, qualquer nó falho interrompe o run: `wf_runs` → `failed`
com o mesmo código e evento `failed` (:684-691). Nada executa depois do erro. Nó de tipo
desconhecido → `wf_node_type_unknown` (:551). Condição com operador inválido nem chega a
rodar: rejeitada na validação (`validateGraph:123-124`) e `conditionTrue` é fail-closed
(`default: return false`, :376).

## Timeout e orçamento (checados a cada iteração do laço)

| Limite | Valor | Efeito | Referência |
|---|---|---|---|
| `runtime_ms` | 10 min | run `failed` `wf_timeout` + evento `timeout` | :34-35, :651-655 |
| `max_nodes` | 50 | run `failed` `wf_node_budget_exhausted` | :36, :656-663 |
| `max_agent_runs` | 10 por run | nó agent/subworkflow `failed` `wf_agent_budget_exhausted` | :37, :485-486, :510-511 |
| `max_depth` | 3 (subworkflow) | `wf_depth_exceeded` na entrada | :38, :609 |

Contadores de consumo em `wf_runs.usage_json` (`agent_runs`), atualizados antes de disparar o
trabalho (:487-491, :512-516). `budget_json` é o snapshot de `WF_BUDGET` gravado na criação
do run (:781-792).

## Cancelamento cooperativo

- Checado entre nós: se `wf_runs.status` virou `cancelled`, o laço para (:649-650).
- `cancelWfRun` (:847-868): nós `pending`/`running`/`waiting_dependency` → `cancelled`;
  run → `cancelled` com `finished_at`. **Efeito externo já iniciado não é revertido** (comentário
  :846). Terminais retornam `unchanged`; `unknown` recusa com `wf_reconcile_required` (:853).

## Retomada por checkpoint

- Aprovação resolvida: `tickWfRuns` (:944-977) encontra nós `waiting_approval` com D9
  resolvido → nó `completed` com saída `{approved:true}`, run volta a `running` e
  `executeWorkflowRun` retoma do checkpoint. Rejeitada → nó e run `failed`
  `approval_rejected`.
- Wait expirado: nós `waiting_dependency` com `wake_at <= now` → `completed`
  `{waited:true}` e retomada (:979-990).
- Tick agendado a cada 20 s (`server/index.js:1871`); também invocado por testes
  (`tests/wf-security.test.mjs:204-205`).
- Boot: `recoverWfRuns` (:873-896) — ver `state-machine.md`.

## Notas honestas de escopo

- O fan-out não é um DAG geral: após uma onda, o laço segue para o primeiro nó `end` do grafo
  (:719-723) — fluxos paralelos convergem no fim.
- `usage_json` hoje só acumula `agent_runs`; campos exibidos na UI como `tool_calls` /
  `model_calls` / `estimated_tokens` (`src/routes/workflows.tsx:696-697`) não são escritos
  pelo motor.
- Cobertura: `tests/wf-engine.test.mjs` (10 testes: grafo, versionamento, execução, condition,
  approval, agent, KH, cancelamento, recovery, subworkflow).

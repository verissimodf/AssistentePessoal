# Tipos de nó (`executeNode`, `server/workflow.js:406-553`)

Tipos válidos: `NODE_TYPES` (:12-23) — 10 tipos. Validação na criação/publish:
`validateGraph` (:75-127). Contexto do nó: `ctx = { run, outputs, owner, depth, agentRunner,
principal, pending, correlation }` (:665-682).

## start / end (:410-413)

- **Entrada:** sem `config` relevante.
- **Saída:** `start` → `{started:true}`; `end` → `{ended:true}`.
- **Validação:** exatamente 1 `start` e ≥1 `end` (`validateGraph:89-92`).
- **Falha:** nenhuma própria (nó desconhecido fora da lista nem valida).

## tool (:414-442)

- **Entrada (`config`):** `tool` (nome em `TOOL_DEFS`), `input` (objeto, com interpolação
  `$node.*` :425), `scope` opcional (override do escopo para a avaliação de política, :417).
- **Fluxo:** política primeiro (`toolPolicyVerdict`, :417-422) → `deny` lança
  `wf_policy_denied` com `policyReason` (:423-424); depois `callTool` real
  (`server/tools.js:1051`), que **revalida** `can()` + D9 + política (:1057-1082).
  `force_approval` + autonomy `full` → `confirm` (:427-428).
- **Saída:** `{ tool, result (≤4000 chars), pending (nº de aprovações enfileiradas) }` (:435-441).
- **Autorização:** escopo do workflow derivado de `allowed_tools` (ADR-WF-004); falha de
  `can()` volta como texto de negação dentro de `result` (não exceção).
- **Falha:** política (acima) ou erro da ferramenta → nó `failed`, run `failed`.

## agent (:479-503)

- **Entrada:** `definition_id` (especialista da Workforce), `objective` (interpolação; cai para
  o objetivo do run, :495).
- **Orçamento:** consome `usage_json.agent_runs` contra `WF_BUDGET.max_agent_runs` (10)
  — estourou → `wf_agent_budget_exhausted` (:481-491).
- **Execução:** `startRun` real de `server/workforce.js:464` (políticas `kind:"agent"`,
  interseção de escopos da Fase 1, `autoExecute` padrão). Erro →
  `wf_agent_start_failed:<código>` (:499).
- **Saída:** `{ agent_run, status }` + vínculo `agent_run_id` persistido no nó (:500-503,
  :593-594). O run do workflow não espera a conclusão do AgentRun (disparo é async,
  `workforce.js:535`).

## subworkflow (:505-528)

- **Entrada:** `definition_id` (de **outra definição publicada** — checado por
  `startWorkflowRun:751`), `objective`.
- **Orçamento:** mesmo contador `agent_runs` (:506-516); profundidade `depth+1` contra
  `WF_BUDGET.max_depth` (3) na entrada de `executeWorkflowRun` (:609).
- **Saída:** `{ workflow_run, status }` com `agent_run_id` = run filho (:524-527).

## condition (:529-531, :361-378)

- **Entrada:** `left`, `op` (`eq|ne|gt|lt|contains` — whitelist em `validateGraph:123`),
  `right` (ambos passam por `resolveValue`).
- **Saída:** `{ result: boolean }`; o laço escolhe a aresta `when:"true"|"false"` (:704-713).
- **Fail-closed:** operador fora da whitelist é rejeitado na validação (:123-124) e
  `conditionTrue` retorna `false` no `default` (:376). Arestas de condition sem `when`
  válido → `condition_edges` (:118-121).

## transform (:464-478)

- **Entrada:** `op` (um dos `KH_OPS` — UI oferece `summary|topics|concepts|compare|synthesize`,
  `src/routes/workflows.tsx:93`), `source_ids` (interpolação, máx 5 em `khTransform:741`),
  `prompt` (≤500).
- **Execução:** `khTransform` do owner (`server/knowledge.js:736`).
- **Saída:** `{ transform_id, result (≤4000), citations }` (:471-477).
- **Falha:** `kh_op_invalid`, `kh_sources_required`, `kh_no_indexed_sources` (`knowledge.js:740-759`).

## knowledge_search (:443-462)

- **Entrada:** `query` (interpolação), `notebook_id` e/ou `library_id` opcionais, `limit`
  (1-10, :449).
- **Execução:** `khSearch` do owner (`server/knowledge.js:604`) — FTS5 + RAG no escopo do owner.
- **Saída:** `{ results: [{ source_id, title, chunk, score, snippet (≤500), citation }] }`
  (:452-461). `citation` carrega `document_id`/`chunk_id`/modo (`knowledge.js:701-710`).
- **Autorização:** sem escopo próprio no nó — a propriedade é do owner; ver
  `knowledge-integration.md`.

## approval (:532-537)

- **Entrada:** `description` (comando exibido no D9, ≤500) e `action` opcional (objeto embutido
  em `approval_actions`).
- **Efeito:** cria D9 real (`createWorkflowApproval` :381-404), nó → `waiting_approval` com
  `approval_id`, evento `approval_pending`; run → `waiting_approval`. Ver `approval-d9.md`.

## wait (:538-549)

- **Entrada:** `duration_ms` (relativo) ou `until` (timestamp absoluto) — `until` prevalece.
- **Saída:** futuro → nó `waiting_dependency` com `wake_at` ISO, run `waiting_dependency`
  (:542-547); já vencido → `{waited:true}` (:548).

## Autorização transversal

O principal do run é `{ type:"bot", botId:"wf:<runId>", adminId, scopes: workflowScopes(def) }`
(:672-679) — escopos derivados de `allowed_tools` via `TOOL_SCOPES` + `workforce:run`
(:45-54, ADR-WF-004). Ferramentas fora da lista são negadas no `callTool` por `can()`
(`tools.js:1057-1059`); a execução nunca amplia a declaração.

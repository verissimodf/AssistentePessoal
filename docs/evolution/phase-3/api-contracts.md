# API Contracts — Workflow Studio e Policy Studio (Fase 3)

Autenticação: sessão de administrador (cookie `jarvis_sid`) + `X-Jarvis-CSRF` em mutações.
Escopos: `workflow:read`/`workflow:write`/`workflow:run` (workflows), `session` (políticas —
apenas admin verificado). Erros: `{ error: "<código>" }` com o status HTTP indicado.

## Workflows — definições

| Método e caminho | Escopo | Corpo | Resposta | Erros |
|---|---|---|---|---|
| `GET /api/workflows` | `workflow:read` | — | `[WorkflowDefinition]` (do owner) | — |
| `POST /api/workflows` | `workflow:write` | `{name, description?, graph:{nodes,edges}, allowed_tools?}` | definição criada (`status:'draft'`, versão 1) | 400 `wf_name_required`/`wf_graph_invalid:<motivo>` |
| `GET /api/workflows/:id` | `workflow:read` | — | definição | 404 |
| `PUT /api/workflows/:id` | `workflow:write` | `{name?, description?, allowed_tools?, graph?}` — graph novo cria versão de trabalho | definição atualizada | 400/404 |
| `POST /api/workflows/:id/publish` | `workflow:write` | — | definição (`status:'published'`) | 400 `wf_graph_invalid:*`; 404 |
| `DELETE /api/workflows/:id` | `workflow:write` | — | `{ok:true}` | 404; 409 `wf_definition_active_runs` |
| `GET /api/workflows/:id/versions` | `workflow:read` | — | `[{version, created_at, graph}]` | 404 |

`graph`: `{nodes:[{id, type, config}], edges:[{from, to, when?}]}` — tipos de nó e configs em
[`node-types.md`](node-types.md); validação em `validateGraph` (`server/workflow.js`).

## Workflows — execução

| Método e caminho | Escopo | Corpo | Resposta | Erros |
|---|---|---|---|---|
| `POST /api/workflows/:id/run` | `workflow:run` | `{objective, idempotency_key?}` | `{run, deduplicated}` — executa até bloquear/terminar | 403 `wf_policy_denied`/`wf_require_approval_unsupported`; 404; 409 `wf_not_published` |
| `GET /api/workflow-runs` | `workflow:read` | query `limit,offset,status,definition_id` | `{items, has_more}` | — |
| `GET /api/workflow-runs/:id` | `workflow:read` | — | run completo: `{status, nodes:[{node_id,node_type,status,attempt,output,error_code,approval_id,agent_run_id,wake_at}], events:[{at,kind,node_id,detail}]}` | 404 |
| `POST /api/workflow-runs/:id/cancel` | `workflow:run` | — | run (`cancelled`) | 404; 409 `wf_reconcile_required` (unknown) |
| `POST /api/workflow-runs/:id/reconcile` | `session` | — | `{outcome, run}` — outcome: `awaiting_approval` \| `not_executed` \| `undetermined` | 404; 409 `wf_reconcile_not_unknown` |

## Policies (Policy Studio — sessão verificada)

| Método e caminho | Corpo | Resposta | Erros |
|---|---|---|---|
| `GET /api/policies` | — | `[Policy]` do owner | — |
| `POST /api/policies` | `{name, scope:'tool'\|'workflow'\|'agent', target, effect:'allow'\|'deny'\|'require_approval', conditions:[{field,op,value?}], description?, priority?, enabled?}` | política (versão 1) | 400 (`name_invalid`, `scope_invalid`, `effect_invalid`, `target_not_a_tool`, `conditions_*`) |
| `GET /api/policies/:id` | — | política | 404 |
| `PUT /api/policies/:id` | campos mutáveis (nova versão + revisão imutável) | política | 400/404 |
| `DELETE /api/policies/:id` | — | `{ok:true}` | 404 |
| `POST /api/policies/simulate` | `{kind, target, tool?, scope?}` | `{decision, matched, reason}` — avaliação SEM executar ação | — |

## Exemplo (demonstração de aceite — `tests/wf-security.test.mjs`)

```json
POST /api/workflows
{
  "name": "Demo-Contrato",
  "allowed_tools": ["notebook_search"],
  "graph": { "nodes": [
    { "id": "start-0", "type": "start" },
    { "id": "kh-1", "type": "knowledge_search", "config": { "query": "contrato X vencimento", "notebook_id": "<nb>" } },
    { "id": "agent-2", "type": "agent", "config": { "definition_id": "<agent>", "objective": "Resuma o vencimento citando a fonte." } },
    { "id": "approval-3", "type": "approval", "config": { "description": "Publicar análise", "action": { "kind": "run_command", "command": "echo publicar" } } },
    { "id": "end-4", "type": "end" } ],
    "edges": [ {"from":"start-0","to":"kh-1"}, {"from":"kh-1","to":"agent-2"}, {"from":"agent-2","to":"approval-3"}, {"from":"approval-3","to":"end-4"} ]
  }
}
```

Execução: `queued → running → waiting_approval` (D9 real criado) → aprovação via
`POST /api/approvals/:id {approve:true}` (owner) → tick retoma → `completed` com evidências
(`execution_evidence`) e eventos (`created → node_started → approval_pending →
approval_resolved → completed`).

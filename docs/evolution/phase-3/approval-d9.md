# Aprovação humana no workflow (nó approval × D9)

## Criação do D9 — `createWorkflowApproval` (`server/workflow.js:381-404`)

Chamado pelo nó `approval` em `executeNode` (:532-537). Em uma transação (:388-396):

1. `INSERT INTO approvals (id, command, status='pending', created_at)` — `command` é
   `config.description || config.command || "aprovação de workflow"` (≤500 chars, :390-391).
2. `assignNew("approval", id, ownerId)` — ownership do approval atribuído ao **owner do run**
   (:392), não ao executor.
3. `INSERT INTO approval_actions (approval_id, action, correlation_id, created_at)` com
   **`correlation_id = id do run`** e a ação embutindo `workflow_node` = id da
   `wf_node_executions` (:393-396) — é o vínculo reverso nó↔approval.
4. Audit `wf.approval_requested` com `correlation` (:397-403).

O nó passa a `waiting_approval` com `approval_id` (:534) e emite `approval_pending` (:535);
o run vira `waiting_approval` (:693-699) e a execução para.

## Retomada — `tickWfRuns` (`server/workflow.js:944-977`)

Para cada nó `waiting_approval` com run `waiting_approval` e `approval_id` (:947-951):

- Approval `pending` (ou inexistente) → segue esperando (:954).
- `done`/`approved` → nó `completed` com saída `{approved:true}` (:956-958), evento
  `approval_resolved {outcome:"approved"}` (:959), run → `running` (:960) e
  `executeWorkflowRun` retoma do checkpoint (:961-962).
- Qualquer outro status (rejeitado) → nó `failed` `approval_rejected` (:964-966), run `failed`
  `approval_rejected` (:967-969), evento `approval_resolved {outcome:"rejected"}` (:970) e
  audit `wf.run_failed` (:971-975).

## Rotas de resolução (já existiam — D9 da Fase 0)

| Rota | Acesso | Função (`server/index.js`) |
|---|---|---|
| `POST /api/approvals/:id` | `session` | aprovar/rejeitar; revalidação no backend (:418) |
| `GET /api/approvals/:id/review` | `session` | revisão pré-aprovação (:439) |
| `POST /api/approvals/:id/reveal` | `session` | revelar conteúdo sensível sob audit (:443) |
| `GET /api/approvals/:id/evidence` | `session` | evidência da execução aprovada (:451) |
| `GET /api/approvals` | `session` | listagem pendentes do owner (:456) |

A resolução atualiza `approvals.status`; o motor descobre a mudança apenas pelo tick (20 s,
`index.js:1871`) — o teste E2E resolve a aprovação e chama `tickWfRuns`
(`tests/wf-security.test.mjs:190-205`).

## Invariantes (verificados em `tests/wf-security.test.mjs:297-339`)

1. **Agente não aprova:** resolução exige rota `session` — principal humano verificado;
   `approvals:resolve` é ADMIN_ONLY (`server/auth.js:54-59`). O principal do workflow é
   classe `bot` (`workflow.js:672-679`) e não tem caminho para `POST /api/approvals/:id`.
2. **Cross-owner → 404:** BIA não resolve aprovação de ANA — ownership do approval + lista
   apenas do owner (`wf-security.test.mjs:318-325`).
3. **Sem reutilização:** cada execução cria seu próprio approval (`approval_id` distintos por
   run, :328-333); a consulta do tick é por `n.approval_id` do nó (:949) — um run nunca retoma
   com aprovação alheia. O `correlation_id` prende a aprovação ao run (:394).
4. **Rejeição é falha, não retry:** `rejected` → run `failed` terminal (não volta a `running`).
5. **Reconciliação honesta:** run `unknown` com approval ainda `pending` volta para
   `waiting_approval` em vez de falhar por suposição (`reconcileWfRun:910-924`).

## Evidência

A resolução D9 gera `execution_evidence` vinculada por `approval_id`, e passos do run geram
evidência por `correlation = run_id` — ambos assertados no teste de aceite
(`tests/wf-security.test.mjs:217-225`; ADR-EVO-009).

# 07 — API HTTP e interface do painel

## 1. Rotas (`server/index.js:931-1002`)

Dispatcher único (`route()`): sessão + escopo + CSRF. `me(principal)` resolve o admin dono.

| Método | Caminho | Escopo | Corpo/query | Resposta |
|---|---|---|---|---|
| GET | `/api/workforce/templates` | `workforce:read` | — | `[{ key, name, role, description, permitted_tools, permission_scopes }]` (931) |
| GET | `/api/workforce/agents` | `workforce:read` | — | `WorkforceDefinition[]` (932) |
| POST | `/api/workforce/agents` | `workforce:write` | corpo do definition | `WorkforceDefinition` (935-943) |
| GET | `/api/workforce/agents/:id` | `workforce:read` | — | `WorkforceDefinition` (944-948) |
| PUT | `/api/workforce/agents/:id` | `workforce:write` | patch parcial | `WorkforceDefinition` (949-957) |
| DELETE | `/api/workforce/agents/:id` | `workforce:write` | — | `{ ok: true }` (958-965) |
| POST | `/api/workforce/agents/:id/run` | `workforce:run` | `{ objective, idempotency_key? }` | `{ run, deduplicated }` (966-977) |
| GET | `/api/workforce/runs` | `workforce:read` | `limit, offset, status, definition_id` | `{ items, has_more }` (978-985) |
| GET | `/api/workforce/runs/:id` | `workforce:read` | — | run completo com `children` e `verification` (986-990) |
| POST | `/api/workforce/runs/:id/cancel` | `workforce:run` | — | run cancelado ou `{ unchanged: true }` (991-996) |
| POST | `/api/workforce/runs/:id/reconcile` | `session` (admin logado) | `{ decision?: "confirm"\|"deny" }` | `{ outcome, run }` (997-1002) |

### Erros (`workforceError`, `index.js:914-930`)

| Código | HTTP | Origem |
|---|---|---|
| `workforce_name_invalid` / `workforce_role_invalid` / `workforce_tools_invalid` / `workforce_scopes_invalid` / `workforce_objective_required` | 400 | validação (`workforce.js:137-159,477`) |
| `workforce_owner_required` | 403 | `createDefinition` sem admin (`workforce.js:136`) |
| `workforce_agent_disabled` | 409 | run em definition desabilitada (`workforce.js:475`) |
| `workforce_definition_active_runs` | 409 | exclusão com runs ativos (`workforce.js:312`) |
| `workforce_reconcile_required` | 409 | cancelar run `unknown` (`workforce.js:970`) |
| `workforce_reconcile_not_unknown` | 409 | reconciliar run não-`unknown` (`workforce.js:1011`) |
| `workforce_reconcile_no_evidence` | 409 | `confirm` sem evidência (`workforce.js:1060`) |
| `not_found` | 404 | recurso inexistente **ou de outro admin** (404 uniforme) — `index.js:946,952,960,974,993,999` |

Qualquer outro erro de validação cai em 400 genérico com o código da mensagem (`index.js:929`).

### Autenticação

- Cookie de sessão `jarvis_sid` + header `x-jarvis-csrf` em mutações — sem cookie: 401; sem CSRF:
  403 (`tests/workforce-security.test.mjs:76-100`).
- Isolamento entre admins: 404 uniforme para definition/run/cancel/reconcile de outro dono
  (`workforce-security.test.mjs:102-160`).

## 2. Exemplos de payload (reais, derivados do código)

Criar definition (`POST /api/workforce/agents`):

```json
{
  "name": "Pesquisador",
  "role": "specialist",
  "description": "pesquisa e resume",
  "instructions": "Faça pesquisas cuidadosas.",
  "permitted_tools": ["web_search", "document_search"],
  "permission_scopes": ["web", "documents:read"],
  "resource_budget": { "max_tool_calls": 10, "max_model_calls": 10, "runtime_ms": 60000, "max_depth": 2, "max_children": 2, "max_tree_runs": 4 },
  "enabled": true
}
```

Executar: `POST /api/workforce/agents/:id/run` com `{"objective": "resumir a notícia de hoje",
"idempotency_key": "op-123"}` → `{ "run": { "id", "status": "queued", "depth": 0, "budget": { "effective_scopes": ["web","documents:read"] } }, "deduplicated": false }`
(`tests/workforce-security.test.mjs:111-119`).

Run completo (`GET /api/workforce/runs/:id`) inclui `verification` (`none|unverified|partial|verified`),
`usage` (`tool_calls`, `model_calls`, `estimated_tokens`), `result` (`output`, `tool_names`,
`children`, `limitations`) e `children[]` (`id`, `definition`, `status`, `verification`, `depth`)
— shape em `bridge.ts:898-920`, produção em `workforce.js:910-934`.

## 3. Área do painel

Rota frontend `/workforce` (`src/routes/workforce.tsx:28`); item de navegação no AppShell
(`src/components/AppShell.tsx:34`). Cliente tipado em `src/lib/bridge.ts:856-1028`; teste de UI em
`src/test/workforce-ui.test.tsx`.

### Seções (`workforce.tsx:260-643`)

| Seção | Conteúdo | Ref |
|---|---|---|
| **Executar** (`wf-run-panel`) | select de definitions + objetivo + botão run | `workforce.tsx:266-291` |
| **Catálogo** (`wf-agents`) | cards com nome, badge de papel, badge "pausado" se `!enabled`, badges de tools/escopos, resumo de orçamento; ações editar/run/pausar/excluir | `workforce.tsx:294-364` |
| **Execuções** (`wf-runs`) | linhas com badge de status + badge de verificação, objetivo, cancelar (status ativos), reconciliar (status `unknown`), detalhe expansível: depth, uso, filhos, limitações, output, `error_code` | `workforce.tsx:367-472` |
| **Templates** (`wf-templates`) | 5 modelos prontos com escopos; botão cria definition a partir do template | `workforce.tsx:475-502` |
| **Formulário lateral** (`wf-form`) | nome, papel, descrição, instruções, checkboxes de tools (`WF_TOOLS`) e escopos (`WF_SCOPES`), campos de orçamento | `workforce.tsx:506-640` |

### Badges de status/verificação

`workforceStatusBadge` (`src/lib/workforce.ts:21-54`): cor por status (`running` azul,
`awaiting_approval` amarelo, `completed` verde, `failed` destructive, `unknown` destructive com
anel); `verified: verification === "verified"` (linha 52). Na página: badge verde com check para
`verified` (`data-testid="wf-verified"`), outline para `partial`/`unverified`
(`workforce.tsx:382-399`).

### Opções fixas da UI

`WF_TOOLS` (12 ferramentas) e `WF_SCOPES` (11 escopos) são conjuntos fechados — o servidor
revalida (`workforce.tsx:43-72`); `WF_ROLES` = 3 papéis (`workforce.tsx:74`).

### i18n

Todos os rótulos via `t()` do `useI18n` (ex.: `wf_status_queued`), com traduções em pt-BR, en e
es (`src/lib/i18n.tsx:203,437,671`). `DEFAULT_STATUS_LABELS` em `workforce.ts:10-18` serve de
fallback fora da página.

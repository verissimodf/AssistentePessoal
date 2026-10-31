# Contratos de API — `/api/ci/*`

Fonte: `server/index.js:1400-1479`. Todas as rotas exigem escopo declarado; a posse do
recurso é checada por `owns` no motor (404 sem vazar existência). Erros são mapeados por
`ciError` (`server/index.js:1401-1414`).

Mapa de erros (`ciError`): `ci_owner_required`→403, `ci_browser_disabled`→409,
`ci_session_not_active`→409, `ci_plan_invalid`→502, `ci_plan_not_planned`→409,
`ci_procedure_deprecated`→409, `ci_name_required`→400, `not_found`→404, demais→400.

## Sessões

| Método | Rota | Escopo | Corpo | Resposta | Erros |
|---|---|---|---|---|---|
| GET | `/api/ci/sessions` | `computer:read` | — | até 100 sessões do admin: `{id, environment, objective, status, created_at, closed_at}` (`server/index.js:1415-1417`) | — |
| POST | `/api/ci/sessions` | `computer:run` | `{objective?, environment?, config?: {allowedHosts?}}` | sessão criada (`getSession` completo) | 403 `ci_owner_required`, 409 `ci_browser_disabled` (`server/index.js:1418-1424`) |
| GET | `/api/ci/sessions/:id` | `computer:read` | — | sessão + `config` + `usage` + `plans` + últimas 10 `observations` | 404 `not_found` (`:1425-1429`) |
| POST | `/api/ci/sessions/:id/close` | `computer:run` | — | `{ok: true}`; remove PNGs e observações | 404, 409 `ci_session_not_active` (`:1430-1434`) |

## Observação / plano / execução

| Método | Rota | Escopo | Corpo | Resposta | Erros |
|---|---|---|---|---|---|
| POST | `/api/ci/sessions/:id/observe` | `computer:read` | — | `{id, hash, dims, content}` — `content` truncado a 4 000 chars na resposta (o PNG fica em `data/ci/<session>/`; o caminho não é exposto na rota) | 404, 409 `ci_session_not_active` (`:1435-1443`) |
| POST | `/api/ci/sessions/:id/plan` | `computer:run` | — | `{plan_id, steps}`; roda `observe` se nenhuma observação for passada | 404, 409 `ci_session_not_active`, 502 `ci_plan_invalid` (`:1444-1452`) |
| POST | `/api/ci/plans/:id/execute` | `computer:run` | — | um de: `{done: bool}`, `{waiting_approval: true}`, `{replanned: true, plan_id}`, `{failed_at: seq}` | 404 (plano fora da sessão do admin), 409 `ci_plan_not_planned`, 409 `ci_timeout` via plano failed (`:1453-1464`) |

Observações do contrato de execução:

- A posse é verificada via `ci_plans.session_id` → `owns(ci_session)` antes de executar
  (`server/index.js:1455-1456`).
- `executePlan` é **assíncrono no sentido humano**: se houver escrita, a resposta típica é
  `{waiting_approval: true}` e o plano é retomado pelo tick de 20 s
  (`server/index.js:2145`) após a resolução da aprovação D9 — não há rota de "retomar".
- Retornos de bloqueio (proibido/negado) aparecem no **estado das ações** (`blocked`), não
  como erro HTTP.

## Procedimentos

| Método | Rota | Escopo | Corpo | Resposta | Erros |
|---|---|---|---|---|---|
| GET | `/api/ci/procedures` | `computer:read` | query `include=deprecated` (opcional) | lista ordenada por `success_count DESC` (sem `deprecated` por padrão) (`:1465-1467`) | — |
| POST | `/api/ci/procedures` | `computer:run` | `{name, goal, steps, criteria?, verified?, environment?}` | `{id, status}` | 403 `ci_owner_required`, 400 `ci_name_required` (`:1468-1474`) |
| POST | `/api/ci/procedures/:id/reuse` | `computer:run` | — | `{id, steps, status, note}` | 404, 409 `ci_procedure_deprecated` (`:1475-1479`) |

## Aprovações D9 (fora de `/api/ci`, caminho compartilhado)

A resolução de aprovações usa as rotas de aprovação já existentes do painel
(`resolveApproval` em `server/tools.js:1680+`); para click/fill o corpo precisa de
`confirmWrite: true` e `fingerprint` (`server/tools.js:1692-1696`). O CI não expõe rota
própria de aprovação.

## Autenticação

Todas as rotas passam pelo `route()` central de `server/index.js`, com a mesma authn de
sessão/token do restante da API; escopos `computer:read`/`computer:run` são negados a
principais sem eles (`server/auth.js:59-60`).

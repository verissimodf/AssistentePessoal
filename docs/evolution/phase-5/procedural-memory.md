# Memória procedural (`ci_procedures`)

Fonte: `server/computer.js:434-487`; schema em `server/migrations.js:1647-1663`.

## Modelo

Procedimento = receita nomeada de passos (mesmo contrato `steps` de um plano), com critério
e contadores de sucesso/falha. Propriedade por admin (`owner_admin_id` + `ownership`
tipo `ci_procedure` — `assignNew` em `server/computer.js:452`); `UNIQUE (owner_admin_id,
name)` (`server/migrations.js:1662`).

Colunas relevantes: `status`, `version`, `success_count`, `fail_count`, `last_used_at`,
`steps_json`, `criteria`, `environment` (padrão `browser`).

## Status (CHECK em `server/migrations.js:1655`)

`observed` → `inferred` → `tested` → `validated`, e `deprecated` como rebaixamento terminal.
Ordem em `PROC_STATUS_ORDER` (`server/computer.js:436`).

## Regras de promoção — `recordProcedure` (`server/computer.js:439-465`)

Registro só é alimentado por **execução verificada** — nunca por plano apenas criado
(`:438`).

| Situação | Resultado |
|---|---|
| Novo procedimento, execução verificada | status inicial **`tested`**, `success_count=1` (`:447-451`) |
| Novo procedimento, sem verificação | status inicial **`observed`**, `success_count=0` (`:447`) |
| Execução verificada em existente, `success_count ≥ 2` | **`validated`** (`:459`) |
| Execução verificada em existente, ainda < 2 sucessos | permanece/atualiza para `tested` (`:459`) |
| Execução não verificada em existente | `fail_count +1`; status mantém se < 2 falhas (`:458-459`) |
| **2 falhas acumuladas** (`fail_count ≥ 2`) | **`deprecated`** (`:459`) |

Cada atualização incrementa `version` e grava `last_used_at` (`:460-462`); auditoria
`ci.procedure_updated` (`:463`).

Ciclo demonstrado no aceite: 1ª execução verificada → `tested`; 2ª → `validated`
(`tests/computer.test.mjs:144-148`).

## Listagem e reutilização

- `listProcedures(adminId, { includeDeprecated })` — ordenado por `success_count DESC`;
  `deprecated` fica fora por padrão (`server/computer.js:467-472`). Rota:
  `GET /api/ci/procedures?include=deprecated` (`server/index.js:1465-1467`).
- `reuseProcedure(adminId, procedureId)` (`server/computer.js:475-487`):
  - ownership checado via `owns` — procedimento de outro admin é `not_found` (teste em
    `tests/computer.test.mjs:205-213`);
  - `deprecated` → erro `ci_procedure_deprecated` (HTTP 409 no mapeamento de rotas,
    `server/index.js:1409`);
  - retorna `{ id, steps, status, note }` com a nota explícita: **"procedimento não carrega
    permissões: cada ação passa por política/D9 na execução"** (`:485`).

## Reutilização sem permissões (invariante)

Os `steps` retornados são dados — ao serem executados como um novo plano, cada ação passa
de novo por: bloqueio de proibidas (`server/computer.js:268-273`), `can()` + Policy Engine +
D9 por ação (`server/tools.js:1051-1082, 1412-1451`) e verificação por critério
(`server/computer.js:310-313`). Nenhum atalho de confiança ou escopo acompanha o
procedimento (`tests/computer.test.mjs:152-158`).

## Não implementado nesta fase

- Nenhum mecanismo automático registra procedimentos ao fim do `executePlan` —
  `recordProcedure` é chamado explicitamente (rota `POST /api/ci/procedures`,
  `server/index.js:1468-1474`).
- O status `inferred` existe no CHECK e na ordenação, mas nenhuma regra do motor o produz
  (`server/computer.js:436`; promoções reais: `observed`/`tested` na criação e
  `validated`/`deprecated` em atualizações).

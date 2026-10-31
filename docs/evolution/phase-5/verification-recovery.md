# Verificação e recuperação

Fonte: `server/computer.js:219-243` (`verify`), `:310-330` (pós-ação) e `:384-432` (tick).

## Verificação pelo critério — aprovação ≠ prova

Retorno positivo do `callTool` **não é prova de resultado**: após toda ação (exceto as que
ficaram pendentes de aprovação), o motor faz uma nova `observe()` e checa o critério
explícito do step (`expected`) contra a observação pós (`server/computer.js:310-313`).

`verify(expected, postObservation, preHash)` (`:219-243`):

| Critério | Checagem | Observação |
|---|---|---|
| `url_contains` | substring normalizada no texto extraído | ok/faltando (`:227-231`) |
| `text_present` | substring normalizada | ok/faltando (`:232-236`) |
| `selector_present` | **indireto via texto** — worker v1 sem DOM dump | sempre registrada como `indireto(texto)` (`:237-240`) |
| sem `expected` | `inconclusive: true`, check `sem_critério` | `:221-224` |

Aprovação D9 confirma a **execução do pedido**, não o efeito no site — por isso o tick
re-verifica pelo critério mesmo após aprovação (`server/computer.js:396-399`).

## Desfechos

| Veredito | Status da ação | Efeito no plano |
|---|---|---|
| `verified` | `succeeded` (auditoria `ci.action_verified`) | continua |
| `inconclusive` | `unknown` (`ci.action_unknown`) | continua; tratado pelo tick |
| divergente | `failed` + `ci_verification_failed` (`ci.action_diverged`) | interrompe; replan ou `failed` |

## Recuperação limitada — replan ≤ 2

Na divergência (`server/computer.js:320-330`):

1. Se ainda há orçamento (`replans < max_replans = 2`) e existe implementação de one-shot
   disponível, um **novo plano** é gerado a partir da observação pós
   (`planActions` com `observation: postObs`) e `executePlan` retorna
   `{ replanned: true, plan_id }`.
2. Sem replan possível/esgotado → plano `failed` e retorno `{ failed_at: seq }`.

Mudança inesperada de interface (stale) é o caso coberto: o teste quebra o app entre o plano
e a execução e exige `ci_verification_failed` + plano não concluído
(`tests/computer.test.mjs:159-171`).

## `unknown` + reconciliação via tick

`tickCiSessions()` (`server/computer.js:384-432`) roda a cada 20 s no serviço
(`server/index.js:2145`, `setInterval(…).unref()`):

1. Seleciona ações `verification_pending` **com** `approval_id` (`:385-387`).
2. Consulta o status da aprovação em `approvals`:
   - `pending`/`running` → nada a fazer (aguardando humano; `running` nunca é rejeição,
     `:393-394`);
   - **`done`** (aprovada e executada) → nova observação + `verify` pelo critério:
     `succeeded`, `unknown` ou `failed` (`ci_verification_failed` → plano `failed`)
     (`:395-419`);
   - **outro** (rejeitada) → ação `cancelled` com `approval_rejected` e plano `failed`
     (`:420-424`).
3. Ações `succeeded` pelo tick adicionam o plano ao conjunto de retomada; cada plano
   retomado volta a rodar `executePlan` (ações restantes continuam sob política/D9)
   (`:426-430`).

O plano que aguarda aprovação nunca é marcado `failed` por isso — retorna
`{ waiting_approval: true }` e permanece `executing` (`server/computer.js:333-337`), permitindo
retomada (status aceitos no `executePlan`: `planned`/`executing`, `:253`).

Auditoria do ciclo: `ci.action_resumed`, `ci.action_unknown`, `ci.action_diverged`,
`ci.action_cancelled` (`:406-423`).

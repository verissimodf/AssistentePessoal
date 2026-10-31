# CI_LIMITS, fluxo de execução e invariantes do motor

Fonte única: `server/computer.js`.

## CI_LIMITS reais (`server/computer.js:29-35`)

| Limite | Valor | Onde aplicado |
|---|---|---|
| `max_actions_per_plan` | 12 | slice no plano (`computer.js:197`) e teto no prompt (`:187`) |
| `max_observations_per_session` | 30 | FIFO: a mais antiga é apagada junto com o PNG (`:117-126`) |
| `max_replans` | 2 | divergência na verificação (`:324`) |
| `max_session_runtime_ms` | 600 000 (10 min) | loop do `executePlan` (`:261-265`) |
| `max_observation_chars` | 40 000 | truncamento do texto de extract (`:146`) |

## Fluxo de execução de um plano

`executePlan(adminId, sessionId, planId)` — `server/computer.js:248-341`.

1. **Retomada**: planos `planned` ou `executing` são aceitos (`:253`); o plano vai para
   `executing` (`:254`).
2. **Timeout global**: decorrido `max_session_runtime_ms`, ação → `failed` (`ci_timeout`) e
   plano → `failed` (`:261-265`).
3. **Bloqueio proibido**: `PROHIBITED_PATTERNS` testado contra o `target_json` ANTES de
   qualquer execução → status `blocked`, `error_code=ci_prohibited_action` (`:269-273`).
4. **Invariantes de estado** (abaixo) e seleção do caminho:
   - **Escritas** (`navigate`, `click`, `fill`, `select`, `wait_for` — `:279`): via
     `callTool("browser_action", …)` com contexto `autonomy: "confirm"` e principal bot
     `ci:<sessionId>` com scopes `["web","web:write","kh:read"]` (`:283-289`). Ou seja:
     `can()` + Policy Engine (Fase 3) + D9 por ação.
     - Aprovação pendente → ação vai a `verification_pending` com `approval_id` e
       `observation_before`; o loop segue e o plano permanece `executing` (`:291-299`, `:333-337`).
     - Negação da política no texto de retorno → `blocked` / `ci_policy_denied` (`:300-304`).
   - **Leituras** (`screenshot`, `read`): `runBrowserAction` direto (op `screenshot`/`extract`),
     sem D9 — leitura de baixo risco com destino validado e auditoria (`:305-309`, `:111-112`).
5. **Verificação pós-ação**: retorno positivo não é prova — nova observação é feita e o
   critério `expected` é checado (`:310-313`, função `verify` em `:219-243`).
   `url_contains`/`text_present` são checados de verdade; `selector_present` é **indireto**
   (via texto — o worker v1 não exporta dump de DOM, `:237-240`).
6. **Desfechos por ação**: `succeeded` (`:314-316`), `unknown` se inconclusivo (`:317-319`),
   `failed` + `ci_verification_failed` se divergiu (`:322-323`).
7. **Recuperação**: em divergência, replan ≤ `max_replans` (novo plano a partir da observação
   pós); sem replan disponível ou esgotado, plano → `failed` (`:324-330`).
8. **Fim**: se restam ações `verification_pending`/`unknown`/`running` → `waiting_approval`;
   caso contrário `done` (se todas `succeeded`/`cancelled`/`blocked`) ou `failed`
   (`:333-340`, `allDone` em `:346-347`).

Mapeamento ação→op do worker: `buildBrowserParams` (`:365-378`) — `select` vira `fill`,
`scroll` vira `wait_for` (2 s), `close` vira `wait_for` de 1 ms.

## Transições atômicas

`setActionStatus(id, from, to, extra)` — `server/computer.js:349-359`: `UPDATE … WHERE id=?
AND status=?` (CAS de uma linha); `changes === 1` decide o prosseguimento.

- Transição `planned → running` falha se a ação já foi tratada (tick/aprovação) — a ação é
  **pulada sem re-executar** (`:274-278`).
- Ações `verification_pending` pertencem ao tick (`tickCiSessions`, `:384-432`);
  `executePlan` nunca as re-executa (invariante em `:274-276`).

## Invariantes do motor

- Escritas **nunca** passam por `runBrowserAction` direto; leituras nunca geram aprovação.
- Proibidas bloqueadas por padrão, sem bypass (não há flag que desligue `PROHIBITED_PATTERNS`).
- Rejeição D9 no tick → ação `cancelled` (`approval_rejected`) e plano `failed` (`:420-424`);
  aprovação `pending`/`running` no banco **não** é tratada como rejeição (`:393-394`).
- Procedimentos só são promovidos por execução **verificada**, nunca por plano criado (`:438`).

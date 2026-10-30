# Policy engine (`server/policies.js`)

Governança comportamental versionada, avaliada no backend, determinística (sem eval de código) —
ADR-EVO-007 e ADR-WF-002. Complementa `can()`/D9/ownership; nunca concede o que eles negam
(comentário `policies.js:1-8`).

## Modelo — `wf_policies` / `wf_policy_revisions` (`server/migrations.js:1204-1228`)

| Coluna (`wf_policies`) | Constraint |
|---|---|
| `id` / `owner_admin_id` | PK / FK `admins(id)` — políticas sempre por admin (ADR-WF-005) |
| `name` | NOT NULL · `UNIQUE(owner_admin_id, name)` |
| `version` | INTEGER NOT NULL DEFAULT 1 (incrementado em cada update, `policies.js:232`) |
| `priority` | INTEGER NOT NULL DEFAULT 0 |
| `scope` | CHECK `('tool','workflow','agent')` |
| `target` | TEXT NOT NULL DEFAULT '*' (nome de tool válida quando `scope='tool'` — `policyValid:66-67`; id/`*` para os demais) |
| `conditions` | TEXT DEFAULT '[]' (JSON `[{field, op, value}]`) |
| `effect` | CHECK `('allow','deny','require_approval')` |
| `enabled` | CHECK `(0,1)` |

`wf_policy_revisions`: snapshot JSON por versão, `UNIQUE(policy_id, version)` — gravado na
criação (:194-197) e a cada update (:248-251). Ownership `wf_policy` (:193).

## Condições — `{field, op, value?}` (`validateConditions`, :40-58)

- `field`: `/^[a-z_]{1,40}$/`; op ∈ `eq|ne|in|not_in|exists` (`OPS`, :15).
- `in`/`not_in` exigem array não vazio; `exists` não leva valor; demais exigem `value` (:51-55).
- Avaliação plana sobre o contexto: `conditionMatches` (:105-121) — `context[field]` comparado
  com `===`, inclusão em lista ou existência. Condição nunca lê código (:104).

## Contextos avaliados

| Kind | Onde | Contexto |
|---|---|---|
| `tool` | `toolPolicyVerdict` (:270-279), usado por `callTool` e nó `tool` | `{ kind, target: tool, tool, scope, agent: botId/tokenId, admin }` |
| `workflow` | `startWorkflowRun` (`workflow.js:752-756`) | `{ kind:"workflow", target: definitionId, admin }` |
| `agent` | `startRun` (`workforce.js:479`) | `{ kind:"agent", target: definitionId, admin }` |

## Decisões e precedência (`evaluatePolicies`, :129-162)

1. Filtra políticas `enabled=1` do admin (cache) com `scope = kind` e `target` igual ou `*`
   (:132-134).
2. Ordena: **deny > require_approval > allow**; entre pares, `priority DESC`, depois
   `created_at` (:135-141).
3. **Fail-closed antes de tudo:** condição inválida (mesmo corrompida no banco) → DENY com
   audit `policy.fail_closed` `invalid_conditions` (:143-149) — a validação roda ANTES do skip
   de lista vazia (:150).
4. Política sem condições não casa nada (não é catch-all, :150); todos os pares devem casar
   (`every`, :151).
5. Match → audit `policy.evaluated` e decisão (:152-159). **Nenhuma política casa →**
   `{ decision:"allow", matched:null }` (:161) — o engine complementa a autorização, não a
   substitui.

## Fail-closed de `require_approval` (ADR-WF-002)

`toolPolicyVerdict` (:270-286): `require_approval` em ferramenta D9-capable
(`D9_CAPABLE_TOOLS`: `run_command`, `cli_agent`, `send_email`, `agentmail_send_email`,
`openhands_task`, `rea_analyze`, `browser_action` — :18-26) vira
`{ decision:"allow", force_approval:true }` (:282); em ferramenta sem caminho de aprovação →
`{ decision:"deny", reason:"tool_has_no_approval_path" }` (:283). Início de agente/workflow com
`require_approval` → negação explícita (`workforce_require_approval_unsupported`,
`workforce.js:481-482`; `wf_require_approval_unsupported`, `workflow.js:761-769`).

## Cache e invalidação (:86-100, :288-292)

Cache por `adminId` (`Map` em memória) das políticas `enabled=1`; toda mutação
(create/update/delete) invalida a entrada do admin (:198, :253, :264). `invalidatePolicyCache`
exportado para correções operacionais direto no banco (:289-292). Políticas de outro admin
nunca são lidas (teste `tests/policies.test.mjs:205`).

## Integração no `callTool` (`server/tools.js:1066-1082`)

Depois de `can()` (:1057): `deny` → retorno auditado `authz.tool_denied reason:policy_denied`
com mensagens distintas para `tool_has_no_approval_path` (:1071-1081); `force_approval` +
autonomy `full` → `confirm` (:1082) — a ferramenta então percorre seu fluxo D9 nativo
(ex.: `run_command` enfileira approval, `tools.js:1106-1120`).

## Integração no `startWorkflowRun` (`server/workflow.js:752-769`)

`deny` → audit `wf.start_denied` e `{error:"wf_policy_denied"}`; `require_approval` → audit e
`{error:"wf_require_approval_unsupported"}` (não há objeto de aprovação para "iniciar
execução"). Demonstração E2E: `tests/wf-security.test.mjs:238-295` (negação de tool e de
workflow inteiro).

## Administração e simulação (rotas `session`, `server/index.js:1321-1357`)

CRUD completo + `POST /api/policies/simulate` (:1348-1357): avalia o contexto informado **sem
executar nada** e devolve `{decision, matched, reason}`. Testes: `tests/policies.test.mjs`
(CRUD, decisões, fail-closed, precedência, isolamento/cache).

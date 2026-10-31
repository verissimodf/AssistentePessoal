# Integração com o Policy Engine e fluxo D9

## Escopos

- Novos escopos humanos/tokens: `computer:read` (observar, listar) e `computer:run`
  (criar/fechar sessão, planejar, executar, procedimentos) —
  `server/auth.js:57-60`. As rotas declaram o escopo rota a rota
  (`server/index.js:1415-1479`).
- No caminho de execução o principal usado é um **bot interno** `ci:<sessionId>` com scopes
  `["web","web:write","kh:read"]` (`server/computer.js:286`) — os escopos `computer:*`
  autorizam o humano a disparar o fluxo; as permissões da ação em si são as da ferramenta
  `browser_action`.

## Policy Engine (Fase 3) dentro do `callTool`

Toda escrita CI passa por `callTool("browser_action", …)` (`server/computer.js:289`), que:

1. Resolve o escopo: `browser_action` → `web`; **click/fill → `web:write`**
   (`server/tools.js:1052-1055`; `TOOL_SCOPES` em `server/auth.js:98`).
2. `can(principal, scope)` re-checado em tempo de execução (`server/tools.js:1057-1060`).
3. Policy Engine: `toolPolicyVerdict(adminId, { tool, scope, principal })`
   (`server/tools.js:1069-1082`):
   - `deny` → execução negada (auditoria `authz.tool_denied`), inclusive com o motivo
     `tool_has_no_approval_path` (ADR-WF-002);
   - `force_approval` com `autonomy: "full"` → degrada para `confirm`.
   O contexto CI já usa `autonomy: "confirm"` (`server/computer.js:284`).
4. Política de integração: browser desabilitado → retorno textual de recusa, que o motor
   converte em `blocked`/`ci_policy_denied` (`server/computer.js:300-304`,
   `server/tools.js:1417`).
5. Validação do pedido antes da aprovação: ops da lista fechada, SSRF/allowlist, limites
   (`server/tools.js:1418-1428`, `server/browser.js:124-169`).

## Fluxo D9 completo para `browser_action`

1. **Pedido**: `queueApproval({ command: summary, action: { kind: "browser_action",
   params, fingerprint } }, adminId, correlation)` — o `fingerprint` (SHA-256 de
   op/url/selector/text/timeout, `server/browser-approval.js:6-18`) congela o pedido;
   `ctx.pending.push({ id })` (`server/tools.js:1429-1449`).
2. **Pendência CI**: ação → `verification_pending` com `approval_id`
   (`server/computer.js:291-298`).
3. **Review**: `browserActionReview` apresenta a operação; para `fill` o texto é
   mascarado (`protectBrowserAction` cifra o payload; reveal explícito) —
   `server/browser-approval.js:23-50`.
4. **Resolução** (`resolveApproval`, `server/tools.js:1680+`):
   - escrita browser (`click`/`fill`) exige admin verificado com `web:write`,
     `review.confirmWrite === true` **e** `review.fingerprint` idêntico ao congelado —
     divergência → `409 browser_review_stale` (`server/tools.js:1692-1696`);
   - transição `pending → running|denied` é um UPDATE condicional (consumida uma única vez,
     `server/tools.js:1727-1730`);
   - gate reavaliado na resolução (integração pode ter mudado; host/URL fora da allowlist →
     `integration_disabled`, `server/tools.js:1719-1725`);
   - execução real: `unprotectBrowserAction` (decifra o payload de `fill` e confere o
     fingerprint de novo) + `runBrowserAction` (`server/tools.js:1799-1801`,
     `server/browser-approval.js:30-39`).
5. **Retorno ao CI**: o tick observa o desfecho da aprovação e aplica verificação/recuperação
   (`server/computer.js:384-432`) — ver `verification-recovery.md`.

O operador real é exercitado nos testes: `resolveHuman` confirma click/fill com
`confirmWrite + fingerprint` (`tests/computer.test.mjs:94-99`).

## Relação com bloqueios CI

O bloqueio de categorias proibidas (`PROHIBITED_PATTERNS`, `server/computer.js:268-273`) é
**anterior** ao D9: ações proibidas nunca criam aprovação — o teste de injeção verifica que
nenhuma linha nova surge em `approvals` (`tests/computer.test.mjs:186-197`).

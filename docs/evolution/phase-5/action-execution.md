# Execução de ações

Fonte: `server/computer.js:216-341` (`executePlan` e auxiliares).

## Classificação das ações

- Tipos válidos (`ACTION_TYPES`, `server/computer.js:42`): `navigate, click, fill, select,
  scroll, wait_for, screenshot, read, close` — CHECK no banco espelha a lista
  (`server/migrations.js:1632`).
- **Escritas** (`isWrite`, `server/computer.js:279`): `navigate, click, fill, select,
  wait_for` → obrigatoriamente via `callTool`.
- **Leituras**: `screenshot` e `read` (mapeadas para op `screenshot`/`extract`) →
  `runBrowserAction` direto, sem D9 (`:305-309`).
- Mapeamento para o worker: `buildBrowserParams` (`:365-378`).

## Bloqueio proibido (antes de tudo)

`PROHIBITED_PATTERNS` (`server/computer.js:39-40`) regex case-insensitive sobre o
`JSON.stringify(target)`: pagamento, pagar, comprar/checkout/carrinho, transferência/pix,
enviar e-mail, publicar post/site, excluir tudo/conta, deletar conta permanente, senha de
admin. Match → `blocked` + `ci_prohibited_action` + auditoria `ci.action_blocked`
(`:268-273`), sem tentativa de execução. Sem bypass configurável.

## Caminho de escrita — D9 por ação (`:281-304`)

1. Contexto: `{ autonomy: "confirm", principal: { type: "bot", botId: "ci:<sessionId>",
   scopes: ["web","web:write","kh:read"] }, correlation: sessionId }` (`:283-288`).
2. `callTool("browser_action", params, ctx)` (`:289`) executa, em ordem:
   - escopo: `browser_action` exige `web`; **click/fill escalam para `web:write`**
     (`server/tools.js:1052-1055`); `can()` no principal (`:1057`);
   - Policy Engine da Fase 3 (`toolPolicyVerdict`): `deny` prevalece; `force_approval`
     degrada `full` → `confirm` (`server/tools.js:1066-1082`);
   - integração browser habilitada + `validateBrowserRequest` (lista fechada de ops, SSRF,
     allowlist, limites) (`server/tools.js:1416-1428`);
   - `queueApproval` com `fingerprint` do pedido (`browserFingerprint`,
     `server/browser-approval.js:6-18`) e o id empurrado em `ctx.pending`
     (`server/tools.js:1431-1449`).
3. `ctx.pending` não vazio → ação vai a **`verification_pending`** com `approval_id` e
   `observation_before`; auditoria `ci.action_pending_approval` (`server/computer.js:291-298`).
4. Texto de negação da política (`/negada|recusada|não está habilitada/`) → `blocked` +
   `ci_policy_denied` (`:300-304`).

## Caminho de leitura — direto (`:305-309`)

`runBrowserAction(adminId, { op: "screenshot"|"extract", timeoutMs: 15000 })`: o destino já
passa por `validateBrowserRequest` + egress pinado no driver (`server/browser.js:389-394,
295-307`); leitura não cria aprovação nem consome D9.

## Verificação e transições atômicas

- Após escrita concluída ou leitura: observação pós + `verify(expected, post, preHash)`
  (`:310-313`).
- Desfechos: `succeeded` / `unknown` / `failed` (`ci_verification_failed`) — detalhes em
  `verification-recovery.md`.
- `setActionStatus` (`:349-359`) é um CAS (`UPDATE … WHERE id=? AND status=?`):
  - ações só entram no loop em status `planned` (`:274-276`) — ações
    `verification_pending` são do tick;
  - se a transição `planned→running` falhar (ação já tratada por tick/aprovação), a ação é
    **pulada sem re-executar** (`:277-278`) — nunca há duplicação de efeito externo.
- Timeout global do plano: `ci_timeout` e plano `failed` (`:261-265`).

## Encerramento do loop (`:333-340`)

- Restam ações `verification_pending`/`unknown`/`running` → retorno `{ waiting_approval:
  true }` e plano permanece `executing` (nunca `failed` por estar aguardando humano).
- Senão: `done` se todas as ações estão em `succeeded`/`cancelled`/`blocked`
  (`allDone`, `:346-347`); caso contrário `failed`.

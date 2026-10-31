# Operação — Computer Intelligence

## Habilitar o navegador gerenciado

1. Rodar o worker Playwright isolado com os sockets Unix do runtime:
   `JARVIS_BROWSER_WORKER_SOCKET` e `JARVIS_BROWSER_POLICY_SOCKET`
   (`server/browser.js:56-57`, `scripts/browser-worker.mjs:30,252-258`). No modo legacy
   TCP, `JARVIS_BROWSER_TOKEN` ≥16 chars é obrigatório ou o worker nem inicia
   (`scripts/browser-worker.mjs:38-43`).
2. Habilitar a integração nas Configurações (globais): `integrations.browser.enabled =
   true` — o gate da sessão CI aceita `enabled === true` ou `mode === "managed"`
   (`server/computer.js:52-55`; configuração efetiva em `server/browser.js:51-80`).
3. Definir `allowedHosts` da integração — destinos fora da lista são recusados
   (`server/browser.js:145-150`).
4. Sem worker configurado, o modo vira `unavailable` e toda execução falha com
   `browser_worker_required` (`server/browser.js:381-388`) — e sessões CI novas falham com
   `ci_browser_disabled` (HTTP 409, `server/index.js:1405`).

## Ciclo operacional de uma sessão

1. **Abrir sessão**: `POST /api/ci/sessions` com `objective` e `environment: "browser"`
   (escopo `computer:run`). Hosts da sessão vão em `config.allowedHosts` (≤20).
2. **Observar**: `POST /api/ci/sessions/:id/observe` (escopo `computer:read`) — PNG em
   `data/ci/<sessionId>/` + texto/hashes.
3. **Planejar**: `POST /api/ci/sessions/:id/plan` — exige o one-shot configurado
   (`runAgentOneShot`; sem ele, `ci_plan_invalid`).
4. **Executar**: `POST /api/ci/plans/:id/execute` — respostas possíveis: `{done}`,
   `{waiting_approval}`, `{replanned, plan_id}`, `{failed_at}`.
5. **Aprovar D9 (quando `waiting_approval`)**: nas telas de aprovações existentes do
   painel; para click/fill a confirmação exige `confirmWrite: true` + fingerprint
   (`server/tools.js:1692-1696`). Rejeitar cancela a ação e falha o plano.
6. **Reconciliar**: o tick interno roda a cada 20 s (`server/index.js:2145`) e retoma
   planos aprovados automaticamente — não há botão de "retomar"; em telas ausentes, basta
   aguardar o ciclo.
7. **Fechar**: `POST /api/ci/sessions/:id/close` — remove todos os PNGs e observações da
   sessão (`server/computer.js:86-98`).

## Pontos de atenção operacional

- **Procedimentos**: registrar com `verified: true` somente após execução verificada;
  2 falhas depreciam o procedimento (`server/computer.js:456-459`).
- **Timeout de plano**: 10 min por execução (`ci_timeout`, `server/computer.js:261-265`);
  planos longos devem ser fatiados.
- **Plano `executing` travado** (ex.: queda do processo com aprovação pendente): o tick
  retoma via ações `verification_pending`; `executePlan` aceita retomada de
  `planned`/`executing` (`server/computer.js:253`).
- **Espaço em disco**: retenção máxima de 30 PNGs/sessão e remoção no fechamento
  (`server/computer.js:31, 117-126, 86-98`).

## Troubleshooting

| Sintoma | Causa provável | Onde olhar |
|---|---|---|
| `ci_browser_disabled` (409) ao abrir sessão | integração browser off ou modo não-gerenciado | `server/computer.js:52-55`, Configurações → integrações |
| `browser_worker_required` | worker não configurado nos sockets | `server/browser.js:381-388` |
| `browser_policy_unavailable` | broker de egress fora | `server/browser.js:302-307` |
| Ação `blocked` com `ci_prohibited_action` | alvo casa `PROHIBITED_PATTERNS` (sem bypass) | `server/computer.js:39-40, 268-273` |
| Ação `blocked` com `ci_policy_denied` | política de comportamento (Fase 3) ou integração recusou | `server/computer.js:300-304`, `server/tools.js:1069-1082` |
| 409 `browser_review_stale` | fingerprint divergente / `confirmWrite` ausente na resolução | `server/tools.js:1692-1696` |
| Ação `failed` com `ci_verification_failed` | interface mudou; ver critério `expected` e observação pós | `server/computer.js:320-330` |
| 502 `ci_plan_invalid` | one-shot não devolveu JSON de plano | `server/computer.js:190-196` |
| 409 `ci_plan_not_planned` | plano já em execução/finalizado fora de retomada | `server/computer.js:253` |
| 409 `ci_session_not_active` | operação em sessão fechada | `server/computer.js:84, 116, 183` |
| Sessão invisível (404) para outro admin | isolamento por ownership — comportamento esperado | `server/computer.js:69, 114, 181` |
| Plano não anda após aprovação | tick de 20 s não rodando (processo parado) | `server/index.js:2145`, `tickCiSessions` |

# UI — Computer Studio

Implementada em `src/routes/computer.tsx` (painel existente; nenhuma segunda aplicação).

## Telas e fluxos

1. **Sessões**: lista com badge de estado (`active`/`closed`/`failed` — helper
   `ciStatusBadge`, `src/lib/computer-ui.ts`); criação por objetivo; detalhe expansível com:
   - **Observações**: hash, dims (`screenshot_ok`, bytes, `final_url`, título) e conteúdo da
     interface em bloco `<pre>` (DADO NÃO CONFIÁVEL — rotulado).
   - **Planos**: passos com ação/alvo/verificação/why.
   - Botões: **Observar** (`observeCiSession`), **Planejar** (`planCiSession`), **Executar
     plano** (`executeCiPlan`), **Encerrar sessão** (`closeCiSession`).
2. **Aprovações D9**: a execução pausa em `waiting_approval` quando há escritas
   (navigate/click/fill); a nota na tela linka para a área de **Aprovações** existente do
   painel — a revisão (review mascarado de `fill`) e a confirmação por fingerprint seguem no
   fluxo D9 original (`server/tools.js`, `resolveApproval`); o tick de 20 s retoma o plano
   (`server/index.js`, `tickCiSessions`).
3. **Procedimentos**: lista com badge (`observed`/`inferred`/`tested`/`validated`/`deprecated`),
   contadores de sucesso/falha, versão; **reutilizar** mostra os passos e a nota
   "não carrega permissões" (`reuseProcedure`).

## Estados exibidos (nunca decorativos)

- Sessão: active/closed/failed.
- Ação: planned/running/succeeded/failed/verification_pending/unknown/reconciling/cancelled/blocked.
- Procedimento: observed/inferred/tested/validated/deprecated.

Todos os dados vêm das rotas `/api/ci/*` (`src/lib/bridge.ts`: `listCiSessions`,
`openCiSession`, `getCiSession`, `closeCiSession`, `observeCiSession`, `planCiSession`,
`executeCiPlan`, `listCiProcedures`, `createCiProcedure`, `reuseCiProcedure`) — internacionalização
pt/en/es (chaves `ci_*`/`nav_computer` em `src/lib/i18n.tsx`).

Validação: `npx vitest run` (inclui `src/test/computer-ui.test.tsx` — helpers + render com
bridge mockada), `npx tsc --noEmit` e `npm run build` — resultados em [`testing.md`](testing.md).

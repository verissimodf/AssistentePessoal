# UI de operações — Workflow Studio e Policy Studio

Duas rotas TanStack: `/workflows` (`src/routes/workflows.tsx`) e `/policies`
(`src/routes/policies.tsx`), com helpers em `src/lib/workflow-ui.ts`. Ambas usam o padrão
`ping()`/demo fallback do painel (`gated`, `workflows.tsx:242-246`).

## Workflow Studio (`/workflows`, `WorkflowsPage` :212)

Layout: coluna esquerda = executar + catálogo + histórico de runs; sidebar = editor
estruturado do grafo (ADR-WF-003 — sem canvas visual; lista de nós com formulários por tipo e
conexões por selects, `workflows.tsx:775-929`).

### Fluxo: criar → publicar → executar → acompanhar → aprovar → reconciliar

1. **Criar/editar** — botão "Adicionar nó" (:397-403), escolha de tipo entre os 10
   (`NODE_TYPES` :70), campos de config por tipo (`nodeConfigFields` :406-558: tool+input;
   left/op/right; op/source_ids/prompt; query/notebook/library/limit; description; duration_ms/
   until; definition_id/objective). Arestas por selects `from → to` com coluna `when`
   para nós condition (:856-907). `buildGraph` (:140) monta o JSON; salvar chama
   `createWorkflow`/`updateWorkflow` — um grafo novo via PUT cria nova versão de trabalho
   (:272-274).
2. **Publicar** — `publishWorkflow` (:302-311); badge de status na card
   (`published` verde / `draft` outline, :608-617) + badge de versão (:618-620).
3. **Executar** — painel superior lista apenas definições `published` (:560, :577); objetivo +
   botão run chamam `runWorkflow` (:324-336). Executar só pela versão `current_version`
   publicada (servidor recusa `wf_not_published`).
4. **Acompanhar** — histórico de runs com badge de status (`wfRunStatusBadge` :665-673),
   uso e versão (:694-698); expandir mostra nós (status, `node_id`, tipo, `attempt`,
   `approval_id`, `agent_run_id`, `wake_at`, `error_code`) e timeline de eventos
   (:702-767).
5. **Cancelar** — botão para runs não terminais (:675-679 → `cancelWorkflowRun` :355-365).
6. **Aprovar** — a aprovação em si acontece no painel de aprovações D9 existente; o run
   mostra o `approval_id` do nó (:727-731).
7. **Reconciliar** — runs `unknown` recebem botão dedicado (:680-684 →
   `reconcileWorkflowRun` :367-377) e um hint explicativo (:699-701).

## Policy Studio (`/policies`, `PoliciesPage` :92)

Todas as rotas exigem sessão verificada (sem escopo delegável — `server/index.js:1321-1357`).

### Fluxo: criar → simular → ativar

1. **Criar/editar** — formulário com nome, descrição, `scope` (`tool|workflow|agent`,
   `POL_SCOPES` :44), `target` (`*` ou id/nome de tool), `effect` (`POL_EFFECTS` :45),
   `priority`, `enabled` e condições dinâmicas `field/op/value` — `in`/`not_in` viram lista
   separada por vírgula; `exists` não leva valor (:148-162). `save` (:145-183) chama
   `createPolicy`/`updatePolicy`.
2. **Simular** — simulador avalia **no servidor** (nunca no cliente, comentário :96-97):
   `runSim` (:206-220) chama `simulatePolicy` com `kind/target/tool/scope` e exibe
   `{decision, matched, reason}` (:108-112). Rota: `POST /api/policies/simulate`
   (`index.js:1348-1357`), que avalia sem executar ação.
3. **Ativar/desativar** — botão de power faz toggle de `enabled` (`toggleEnabled` :185-193);
   badges mostram efeito (`wfEffectBadge` :241-250), escopo (:251), alvo (:252-254) e
   estado (:255-266); condições exibidas como badges monoespaçados (:271-281); prioridade e
   versão no rodapé da card (:283-285).
4. **Excluir** — `deletePolicy` (:195-204).

## Helpers de badge (`src/lib/workflow-ui.ts`)

- `wfRunStatusBadge(status, labels)` (:35-71): running azul; `waiting_*` amarelo;
  `completed` verde; `failed` destructive; `unknown` destructive com anel;
  `queued`/`pending`/`cancelled` outline/cinza. Rótulos injetados com default pt-BR
  (`DEFAULT_WF3_RUN_LABELS` :10-20). Status desconhecido → fallback destrutivo com anel
  (:62-65) — fail-closed visual.
- `wfEffectBadge(effect, labels)` (:77-97): `deny` vermelho, `require_approval` amarelo,
  `allow` verde.
- `describeNode(type, config)` (:100-133): descrição curta pt-BR de cada nó a partir da
  config (usada sob cada nó no editor, `workflows.tsx:845`).

## i18n e acessibilidade

Todos os rótulos via `useI18n` com chaves `wf3_*` / `pol_*` / `kh_op_*`
(`workflows.tsx:222-232`, `policies.tsx:114-131`); selects com `aria-label`
(ex. `workflows.tsx:431, 891`); testes de UI em `src/test/workflow-ui.test.tsx`.

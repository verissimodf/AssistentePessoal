# Decisões Técnicas — Fase 3

## ADR-WF-001 — Sem terceira fila: motor de workflow com estado persistido e executor in-process

**Status:** ACCEPTED · **Contexto:** o mandato pede unificação de `durable_jobs` (bots:
`bot_id NOT NULL`, trigger CHECK 'daily/interval/file') e `kh_jobs` (ingestão), sem criar um
terceiro sistema de jobs. **Decisão:** workflows NÃO usam fila — usam estado persistente por
execução de nó (`wf_runs`/`wf_node_executions`) + executor in-process determinístico (ondas de
nós prontos, paralelismo ≤ 2) com recuperação no boot (`recoverWfRuns`: `running`→`unknown`;
`queued` retomado; `waiting_*` permanecem — estados reais) e tick de 20 s para retomadas
(aprovações resolvidas / waits expirados). **Consequências:** nenhuma fila nova foi criada e
nenhuma das duas existentes foi alterada (risco zero ao scheduler de bots e à ingestão do Hub);
a unificação completa por abstração fica condicionada à Fase com evidência medida.

## ADR-WF-002 — `REQUIRE_APPROVAL` força D9 ou nega (nunca autoriza)

**Status:** ACCEPTED · **Contexto:** mandato exige que `require_approval` encaminhe ao D9,
nunca autorize. Ferramentas sem caminho de aprovação (ex.: `web_search`) não têm o que aprovar.
**Decisão:** `toolPolicyVerdict` (`server/policies.js`) → ferramentas D9-capable (run_command,
cli_agent, send_email, agentmail_send_email, openhands_task, rea_analyze, browser_action)
recebem `force_approval` (autonomy forçada a confirmar); as demais recebem **negação** com
`tool_has_no_approval_path`. Início de agente/workflow com `require_approval` → negação
fail-closed (`workforce_require_approval_unsupported` / `wf_require_approval_unsupported`) —
não há objeto de aprovação para "iniciar execução" nesta fase. **Consequências:** nenhum
caminho autoriza sem aprovação real; limitação documentada (`limitations.md`).

## ADR-WF-003 — Editor estruturado em vez de editor visual de grafo

**Status:** ACCEPTED · **Contexto:** um editor visual seguro exigiria dependência de grafo
nova (react-flow etc.). **Decisão:** editor estruturado (lista de nós com formulários por
tipo + conexões por selects com `when` para conditions) + visualização em lista/timeline.
**Consequências:** zero dependência nova; o grafo continua validado no backend
(`validateGraph`: ciclos, start/end, tipos, arestas, condition edges/op).

## ADR-WF-004 — Escopos do workflow derivados de `allowed_tools`

**Status:** ACCEPTED · **Contexto:** nós `tool`/`agent` precisam de autorização; o workflow
não deve ter poderes além do que o operador declarou. **Decisão:** o principal do run
(classe "bot", criado pelo backend) recebe os escopos mapeados de `allowed_tools` via
`TOOL_SCOPES` (+ `workforce:run` quando há capacidades); ferramentas fora da lista são
negadas por `can()`; nós agent recebem a interseção da Fase 1 com esses escopos.
**Consequências:** sem escalação implícita; a declaração do operador é o teto.

## ADR-WF-005 — Políticas por admin (sem políticas globais nesta fase)

**Status:** ACCEPTED · **Contexto:** políticas globais cruzariam o modelo de ownership e
poderiam enfraquecer o isolamento entre administradores. **Decisão:** `wf_policies` sempre
com `owner_admin_id` (avaliadas só para o owner da execução); administração por sessão
verificada. **Consequências:** o operador único (uso atual) não sente diferença; políticas
globais ficam como decisão de produto futura.

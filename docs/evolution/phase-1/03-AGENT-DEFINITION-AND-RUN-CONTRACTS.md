# 03 — Contratos: AgentDefinition e AgentRun (implementados)

Comparado ao contrato conceitual da Fase 0 (`docs/evolution/phase-0/04-AGENT-AND-WORKFLOW-CONTRACTS.md`).
Tudo abaixo existe no código; simplificações estão marcadas.

## 1. AgentDefinition — campos implementados

Persistência em `createDefinition` (`workforce.js:135-195`); leitura hidratada em `defRow`
(`workforce.js:123-133`). Shape TypeScript: `bridge.ts:862-887`.

| Campo | Implementação | Ref |
|---|---|---|
| `id` | `uid()` | `workforce.js:162` |
| `owner_admin_id` | obrigatório; ownership via `assignNew("agent_definition", ...)` | `workforce.js:136,191` |
| `name` | 1–80; único por admin (UNIQUE no schema) | `workforce.js:137-138` |
| `role` | `orchestrator \| specialist \| worker`; default `specialist` | `workforce.js:139-140` |
| `description` | cap 2000 | `workforce.js:141` |
| `version` | inicia em 1; `+1` a cada update bem-sucedido | `workforce.js:177,273` |
| `instructions` | cap 20000 | `workforce.js:142` |
| `instruction_ref` | string ≤200 ou null | `workforce.js:179` |
| `instruction_checksum` | sempre `null` — **reservado** (sem verificação em runtime) | `workforce.js:180` |
| `model_preferences` | `{ provider ≤60, model ≤120 }` ou `{}` | `workforce.js:143-155` |
| `permitted_tools` | ids existentes em `TOOL_DEFS`; dedup | `sanitizeDefinitionTools`, `workforce.js:104-108` |
| `permission_scopes` | escopos existentes em `SCOPES`; dedup | `sanitizeDefinitionScopes`, `workforce.js:91-100` |
| `resource_budget` / `execution_limits` | `clampBudget` | `workforce.js:160-161` |
| `enabled` | default `0` (desabilitado); run em definition desabilitada é recusado | `workforce.js:186`, `workforce.js:475` |
| `metadata` | objeto livre | `workforce.js:187` |

### Validações (fail-closed, recusa explícita — não filtro silencioso)

- `sanitizeDefinitionScopes` (`workforce.js:91-100`): recusa lista não-array, item não-string,
  escopo inexistente em `SCOPES`, `"*"` e qualquer `ADMIN_ONLY` → erro `workforce_scopes_invalid`.
- `sanitizeDefinitionTools` (`workforce.js:104-108`): recusa se **qualquer** item não existir em
  `TOOL_DEFS` → `workforce_tools_invalid`.
- `clampBudget` (`workforce.js:49-63`): recorta cada dimensão a `HARD_LIMITS`; valor inválido
  (NaN/≤0) cai no `DEFAULT_BUDGET` (`max_tokens` → `null` → default).

### Edição e exclusão

- Campos editáveis fechados em `DEF_EDITABLE` (`workforce.js:209-222`); `id`/`owner`/`created_at`
  não são alteráveis (teste `workforce-core.test.mjs:106-108`).
- `deleteDefinition` recusa se há runs ativos (`workforce_definition_active_runs`,
  `workforce.js:307-312`); apaga runs + ownership em uma transação (`workforce.js:313-320`).

## 2. AgentRun — campos implementados

Criação: raiz em `startRun` (`workforce.js:491-520`), filho em `delegate` (`workforce.js:806-832`).
Shape TypeScript: `bridge.ts:898-920`.

| Campo | Implementação | Ref |
|---|---|---|
| `definition_id` + `definition_version` | versão imutável capturada na criação | `workforce.js:500-501` |
| `owner_admin_id` | herdado do solicitante; filho usa o mesmo dono | `workforce.js:817` |
| `parent_run_id` | null (raiz) ou id do pai | `workforce.js:497,818` |
| `correlation_id` | agrupa a árvore; usado por evidência/aprovações | `workforce.js:503,819` |
| `idempotency_key` | dedup por `(owner, key)`; devolve o run existente com `deduplicated: true` | `workforce.js:478-483` |
| `objective` | cap 8000, trim | `workforce.js:476-477,505` |
| `status` | máquina de estados — ver `05-EXECUTION-STATE-AND-RECOVERY.md` | `workforce.js:65-73` |
| `depth` | 0 na raiz; pai.depth + 1 no filho | `workforce.js:367` |
| `budget_json` | `{ allocation, effective_scopes, granted_by, max_depth, max_children, max_tree_runs, max_retries, max_concurrent_children }` (+`taskContext` no filho) | `workforce.js:506-515,822-827` |
| `usage_json` | `{ tool_calls, model_calls, estimated_tokens }` | `workforce.js:632-644` |
| `result_json` | `{ status, output ≤20000, tool_names, children, citations, limitations, produced_at }` | `workforce.js:667-679` |
| `checkpoint_json` | `{ stage, step, model_calls, tool_calls, correlation, at }` | `workforce.js:590-604` |
| `error_code` | `definition_missing`, `interrupted`, `workforce_budget_exhausted`, `workforce_executor_error`, null | `workforce.js:562,734-737,992` |
| `evidence_ids` | coluna `[]`; evidência real vai ao ledger `execution_evidence` | `workforce.js:714-721` |

## 3. Diferenças vs. Fase 0 (o que foi simplificado)

| Item do contrato Fase 0 (04 §) | Status na Fase 1 |
|---|---|
| `TaskDefinition` (§3) | **Não implementado** — não existe tabela nem tipo |
| `TaskExecution` (§4) com `attempt`/backoff de retry | **Não implementado** — `max_retries` é reservado (04), executor não faz retry |
| `AgentCommunication` envelope estruturado (§5) | Substituído por `context` (string ≤8000, `workforce.js:826`) + resultado JSON marcado DADO NÃO CONFIÁVEL (`workforce.js:885-889`); sem campo de autorização (atende §5) |
| `result_reference`/`evidence_reference` como FK (§2) | Embedados em `result_json` + ledger `execution_evidence` (sem FK) |
| `requesting_user` propagado (§2) | Implementado como `granted_by` em `budget_json` + escopos efetivos (`workforce.js:509`) |
| Checksum de instruções em runtime (TH-03) | `instruction_checksum` reservado, sempre null (`workforce.js:180`) |
| `instruction_reference` com procedência obrigatória | `instruction_ref` opcional (string livre ≤200) |

## 4. Imutabilidade

- Runs referenciam a versão do definition na criação (`definition_version`); edição do definition
  não altera runs existentes.
- `ownership` é imutável por trigger (`migrations.js:834-835`); runs nascem com dono e nunca
  trocam de admin (`workforce.js:519`, `831`).
- Status final de run cancelado não é reaberto nem re-marcado (`workforce.js:656-712`).

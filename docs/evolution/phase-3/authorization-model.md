# Modelo de autorização — fronteiras da Fase 3

A Fase 3 não cria um novo sistema de autorização; encaixa-se nos existentes (Fases 0-2).
Princípio (ADR-EVO-007): **guidance nunca substitui enforcement** — política não cria permissão.

## Choke point único

- Toda rota declara seu acesso na criação (`route(..., acesso, ...)`, `server/index.js`);
  a lista pública é mínima e assertada por `tests/http-auth.test.mjs` (regra do `AGENTS.md`).
- Rotas do Workflow Studio: `workflow:read` / `workflow:write` / `workflow:run`
  (`server/index.js:1239-1319`) — escopos novos registrados em `SCOPES`
  (`server/auth.js:47-51`).
- Rotas do Policy Studio: todas `session` (`index.js:1321-1357`) — administração de políticas
  é feita somente por sessão humana verificada, sem escopo delegável (comentário
  `auth.js:47-48`).
- Execução de ferramenta sempre re-passa por `callTool`, que revalida `can()` em tempo de
  execução (`server/tools.js:1050-1060`) — inclusive quando chamado pelo nó `tool`
  (`workflow.js:426-434`).

## `can()` e principal do workflow

- O run recebe principal classe `bot` criado **pelo backend**:
  `{ type:"bot", botId:"wf:<runId>", adminId: owner, scopes: workflowScopes(def) }`
  (`server/workflow.js:672-679`). Objetos forjados não passam — apenas principals emitidos por
  `validateSession()` têm poder (regra de `AGENTS.md`; `isVerifiedAdmin()` para rotas de
  sessão).
- `can(principal, scope)` é checado no `callTool` por ferramenta
  (`auth.js:62-99`, `tools.js:1057-1059`).

## Escopos derivados de `allowed_tools` — `workflowScopes` (ADR-WF-004)

`workflowScopes` (`workflow.js:45-54`): mapeia cada tool declarada na definição para seu escopo
via `TOOL_SCOPES` e, se houver qualquer escopo, adiciona `workforce:run` (nós
agent/subworkflow). Garantias:

- A declaração do operador é o **teto** — execução nunca amplia (`workflow.js:42-44`).
- Ferramenta fora da lista → sem escopo no principal → `can()` nega no `callTool`.
- Ferramentas sem mapeamento em `TOOL_SCOPES` são simplesmente ignoradas na derivação (:51).

## Interseção da Fase 1 (nós agent)

Nós `agent` chamam `startRun` real (`workforce.js:464`), que recalcula o conjunto efetivo do
AgentRun como **escopos pedidos pela definição ∩ escopos do principal solicitante**
(`grantedScopes` + filtro, `workforce.js:491-495`); sem interseção não vazia →
`workforce_scopes_not_granted` (:494-495). Ou seja: o workflow só delega o que ele próprio tem,
e o especialista só recebe a interseção (comentário `tools.js:1520-1524` sobre
`delegate_agent`, mesmo princípio).

## D9 (aprovação humana)

- Ferramentas com efeito no mundo têm fluxo D9 nativo no `callTool`
  (`run_command` `tools.js:1106-1120`, `cli_agent` :1146-1160, `send_message` :1168+).
- Nó `approval` cria D9 dedicado ao run (`workflow.js:381-404`); resolução só por sessão
  (`index.js:418`); `approvals:resolve` é ADMIN_ONLY (`auth.js:54-59`).
- Política `require_approval` força o caminho D9 ou nega (ADR-WF-002, `policies.js:270-286`).

## Ownership

- Toda entidade wf_* nasce com `assignNew` amarrada ao admin dono
  (`wf_definition` :150, `wf_run` :793, `wf_policy` `policies.js:193`, `approval` :392).
- Leituras/escritas filtram por `owns()`/`owner_admin_id`
  (`workflow.js:168, 807, 826-830`; `policies.js:213, 259`); tabelas ordenam por
  `owner_admin_id`. Cross-owner → 404 (assertado em `tests/wf-security.test.mjs:234-235`).
- Ownership é imutável (trigger `trg_ownership_immutable`, `migrations.js:1244-1245`); tipos
  `wf_definition|wf_run|wf_policy` adicionados ao CHECK da tabela na v22 (:1234).

## Políticas como complemento

Avaliadas **depois** de `can()` e **antes** do efeito (`tools.js:1066-1082`), no início de
workflow/agent (`workflow.js:752`, `workforce.js:479`) e no nó `tool` (`workflow.js:417-424`).
Nenhuma decisão de política concede escopo, pula D9 ou contorna ownership — fail-closed em
condição inválida (`policies.js:143-149`) e em `require_approval` sem caminho D9 (:281-284).

## Resumo das camadas (na ordem avaliada)

1. Sessão/escopo da rota (choke point `route()`).
2. Ownership (`owns` — recursos de outros admins invisíveis).
3. `can()` no `callTool` (escopo por ferramenta, tempo de execução).
4. Policy engine (deny/require_approval/allow, fail-closed).
5. D9 (aprovação humana) para efeito externo.

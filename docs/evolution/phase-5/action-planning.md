# Planejamento de ações (plan via one-shot)

Fonte: `server/computer.js:163-214`.

## Como um plano é gerado

`planActions(adminId, sessionId, { observation?, oneShotFn? })`:

1. Sessão precisa existir, pertencer ao admin e estar `active` (`:181-183`).
2. Usa a observação fornecida ou faz `observe()` na hora (`:184`).
3. Chama o **one-shot** (`:169-177`): por padrão `runAgentOneShot` de `server/kh-oneshot.js`
   com principal de serviço `{ type: "service", tokenId: "ci-plan", adminId, scopes: [] }` —
   o planejador não tem escopos de ferramenta; só produz texto.
4. O prompt (`:187`) contém:
   - objetivo da sessão;
   - o texto observado **rotulado como dado não confiável** (truncado a 8 000 chars);
   - o contrato de saída JSON:
     `{"steps":[{"action":"navigate|click|fill|select|scroll|wait_for|read",
     "target":{"url","selector","text"},"expected":{"url_contains","text_present",
     "selector_present"},"why":"..."}]}`;
   - teto de ações e a **proibição explícita no prompt** (pagamento, compra, transferência,
     envio real, exclusão irreversível).
5. O JSON é extraído da resposta (primeiro bloco `{…}`) e parseado; falha →
   `ci_plan_invalid` (`:190-196`).
6. `rawSteps` é truncado a `max_actions_per_plan` (12) (`:197`).

## Persistência do plano (`server/computer.js:200-211`)

Em uma transação (`tx`):

- `ci_plans` com `status='planned'`, `steps_json` e `observation_id` da observação-base.
- Um `ci_actions` por passo, com `seq`, `action_type` (valor fora da lista fechada
  `ACTION_TYPES` degrada para `read`, `:206`), `target_json` e `expected_json`, status
  `planned`.

Auditoria `ci.plan_created` (`:212`).

## Bloqueio de categorias proibidas — duas camadas

1. **No prompt**: o one-shot é instruído a não incluir ações de pagamento/compra/
   transferência/envio real/exclusão irreversível (`server/computer.js:187`).
2. **No backend (autoritativa)**: `PROHIBITED_PATTERNS`
   (`server/computer.js:39-40`) é testado sobre o `target_json` de cada ação **antes de
   qualquer execução**; match → status `blocked`, `error_code=ci_prohibited_action`,
   auditoria `ci.action_blocked`, e o loop segue para as próximas ações
   (`server/computer.js:268-273`). Não existe bypass nesta fase.

Testes: plano de pagamento é bloqueado (`tests/computer.test.mjs:174-184`); plano originado
de instrução exibida na página também (`tests/computer.test.mjs:186-197`).

## Propriedades do plano

- Passos **pequenos e verificáveis**: cada step carrega seu próprio critério `expected`
  (`url_contains`/`text_present`/`selector_present`), consumido pela verificação pós-ação
  (`server/computer.js:219-243`).
- O plano é vinculado à observação que o originou (`ci_plans.observation_id`) — base para
  detectar stale observation na verificação.
- Replan: em divergência de verificação, `executePlan` gera um **novo plano** (não edita o
  atual) a partir da observação pós, limitado a `max_replans = 2`
  (`server/computer.js:324-327`).

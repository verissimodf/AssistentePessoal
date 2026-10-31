# Integração — Workflow Engine (Fase 7, §11)

## Única porta de execução

Toda execução proativa nasce em `startWorkflowRun(adminId, workflowId, {objective,
idempotencyKey: "pr-opp:{opportunityId}"})` — que mantém intactos:

- Policy Engine (`evaluatePolicies`): `deny` → bloqueado; `require_approval` → negado
  (sem caminho D9 para INICIAR run, ADR-WF-002);
- idempotência por chave (re-aceite não duplica);
- orçamento (`WF_BUDGET`), fan-out limitado, timeouts;
- D9 nativo para etapas protegidas (`approval` node / `REQUIRE_APPROVAL`).

## Sink de eventos (extensão mínima)

`workflow.js` recebeu APENAS: variável de módulo `wfEventSink` + `setWfEventSink(fn)` +
chamada best-effort em `emit()`. O motor proativo registra o produtor no boot. Sem
importação reversa (workflow.js não conhece proactive.js) — sem dependência circular.

## Reconciliação

`tickProactive` consulta oportunidades `executing` com `workflow_run_id`:
- run `completed` → oportunidade `completed` + notificação;
- run `failed`/`cancelled` → oportunidade `failed` + notificação de alta prioridade;
- run ainda em curso (ex.: `waiting_approval`) → nada feito (aguarda).

Estados desconhecidos são reconciliados com EVIDÊNCIA do run — nunca repetidos
cegamente (§11; testes 23/24).

# Gatilhos por Eventos Internos (Fase 7)

## Fontes registradas (whitelist — §6.2.B)

`workflow` · `research` · `learning` · `kh` · `workforce` · `mm` · `computer` ·
`manual` · `system`.

Nenhuma fonte fictícia: só entram fontes que existem no código. Evento com fonte fora
da whitelist é **rejeitado** (`pr_invalid_source`) e nunca registrado (testado).

## Sink do Workflow Engine (inversão de dependência)

`workflow.js` ganhou um único ponto de extensão — `setWfEventSink(fn)` — chamado em
`emit()` com try/catch (best-effort: o sink NUNCA altera o fluxo do run). No boot,
`proactive.registerWorkflowEventSink()` registra o produtor:

- kinds de interesse: `created, completed, failed, timeout, cancelled,
  approval_pending, approval_resolved` → viram eventos `wf_*` em `pr_events` do dono
  do run, com dedupe (`wf:{runId}:{kind}:{node}:{at}`);
- `approval_pending` gera notificação `approval_needed` de alta prioridade;
- regras `active` com gatilho `event` (source `workflow`) disparam
  `handleRuleTriggered` com o evento.

## Proteções (§11, §15)

- **Tempestade**: teto de 60 eventos/minuto por dono (`pr_event_storm`, 429).
- **Replay**: `dedupe_key` UNIQUE por dono — o mesmo evento duas vezes é registrado
  uma só; a segunda chamada devolve `duplicate: true` sem reprocessar.
- **Payload é DADO**: o conteúdo (incluindo texto injetado tipo "ignore as regras")
  alimenta apenas condições por caminho de campo e evidências — nunca instrução.
- **Manual**: `source: "manual"` permite ao operador produzir eventos para testar regras
  (mesmas condições, limites e políticas) — autorização real continua no Workflow Engine.

## Eventos das outras fases

Pesquisa concluída (Deep Research), documento novo no Knowledge Hub, conclusão de sessão
multimodal, falha de execução — entram conforme os módulos os reportarem via
`recordEvent`; a integração é aditiva e sem acoplamento (quem tem a informação chama;
o motor não importa os módulos).

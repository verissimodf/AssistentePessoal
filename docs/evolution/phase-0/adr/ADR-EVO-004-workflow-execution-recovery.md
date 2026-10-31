# ADR-EVO-004 — Execução e recuperação de workflows

**Status:** ACCEPTED · **Data:** 2026-10-30 · **Fase:** 0

## Contexto
Não existe engine de workflows no sistema (zero ocorrências de "workflow" em `server/` —
`01` §15). Existe: fila `durable_jobs` (v16) com lease/heartbeat/recovery conservador, ledger de
disparos (v15), aprovações D9 e ledger de evidência (v10). O padrão AutoGPT (grafos versionados
+ executor separado) e Open Notebook (fila em tabela + worker) são referências (`07`).

## Problema
Como executar fluxos multi-step duráveis com ramificação, aprovação humana e recuperação, sem
repetir efeitos externos e sem introduzir serviço novo.

## Opções consideradas
1. Motor externo (Temporal, n8n, RabbitMQ-based).
2. Motor interno sobre tabelas SQLite (definição/run/step_states) usando `durable_jobs` como
   transporte.

## Decisão
Opção 2 (`04` §7): `workflow_definitions` versionadas, `workflow_runs` com
`step_states[]` persistentes, checkpoint por step, nós de aprovação mapeando para D9, idempotência
por `step_key`, retomada a partir do checkpoint, `unknown` para steps com efeito iniciado não
confirmado.

## Racional
- Reutiliza lease/recovery/idempotência já testados (v15/v16) e a regra "efeito já ocorreu ⇒
  nunca re-executar" (`jobs.js:158`).
- Mantém a stack SQLite e a operação local-first; rejeita serviço novo sem evidência de
  necessidade (roadmap 2026-10-27).
- Distinção explícita entre sucesso técnico e conclusão de negócio verificada (invariante I7).

## Consequências
- Positivas: workflows auditáveis com evidência por step; recuperação previsível.
- Negativas: motor próprio a manter; concorrência limitada ao modelo single-thread in-process
  atual (aceitável no escopo pessoal; revisitar com critério de `03` §5).

## Implicações de segurança
Cada step que chama ferramenta passa por `callTool` (revalidação); nós humanos são approvals D9;
TH-11/12 cobertos por idempotência de step.

## Alternativas rejeitadas
1 (novo serviço + nova infra; licensing/complexidade sem benefício medido).

## Referências
`04` §7; `03` §3.5; `07` §2 (AutoGPT), §3 (Open Notebook); `server/jobs.js`; `adr/ADR-EVO-003`.

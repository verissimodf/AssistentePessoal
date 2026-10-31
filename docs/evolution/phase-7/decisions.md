# Decisões Técnicas — Fase 7 (ADRs)

## ADR PR-001 — Execução exclusiva via Workflow Engine; sem tabela de "execuções" própria

**Contexto**: §6 pede ProactiveExecution; criar uma tabela própria duplicaria o motor de
execução.
**Decisão**: a execução proativa É um `wf_run` correlacionado (`workflow_run_id` +
`idempotencyKey pr-opp:{id}`). O motor nunca executa nada diretamente.
**Consequência**: políticas, D9, orçamento, cancelamento e reconciliação herdados de
graça; correlação consultável (`getExecutionTrail`).

## ADR PR-002 — Eventos: sink único no Workflow Engine + whitelist de fontes

**Contexto**: §6.2.B exige eventos internos; não há barramento e não se deve criar
infraestrutura paralela.
**Decisão**: `setWfEventSink` (inversão de dependência, best-effort) + `pr_events` com
fontes em whitelist e `dedupe_key` UNIQUE. Outros módulos reportam via `recordEvent`
quando houver informação.
**Consequência**: sem segundo barramento; replay impossível no banco; ampliação é
aditiva.

## ADR PR-003 — Condições vazias = sempre verdadeiro; validação estrutural no save

**Contexto**: regras sem condições devem disparar; condições inválidas não podem nem
ser salvas nem autorizar.
**Decisão**: vazio/nulo → `ok:true` (explícito); `assertConditionsValid` rejeita
estrutura/operador inválidos no save (`pr_invalid_conditions`); a avaliação continua
fail-closed.
**Consequência**: UX de regras simples sem abrir brecha de avaliação arbitrária.

## ADR PR-004 — Violação de limite de condições é terminal (correção de fail-closed)

**Contexto**: profundidade/nós excedidos retornavam falso dentro da árvore — NOTs
aninhados invertiam a violação de volta a verdadeiro.
**Decisão**: `checked.violated` torna a violação terminal (falso fora da árvore,
não-invertível).
**Consequência**: fail-closed real, verificado por teste (10 NOTs aninhados → falso).

## ADR PR-005 — Ownership: `ownership` para regras; coluna do dono para derivados

**Contexto**: §6.1 exige ownership em cada entidade; a tabela canônica é imutável e
auditável.
**Decisão**: `pr_rule` entra em `ownership` (recurso top-level); eventos/oportunidades/
notificações têm `owner_admin_id` NOT NULL com filtro obrigatório (padrão das
conversas).
**Consequência**: isolamento idêntico sem linhas espúrias; teste cross-owner cobre.

## ADR PR-006 — Ordem dos guardas: idempotência antes do cooldown

**Contexto**: replay/ocorrência duplicada deve ser reconhecida como tal (e não como
"cooldown"), para observabilidade honesta.
**Decisão**: dedupe → cooldown → condições → taxa → pendentes.
**Consequência**: diagnósticos precisos; nenhuma diferença de segurança (ambos
bloqueiam).

## ADR PR-007 — Notificações internas; sem canal externo

**Contexto**: §13 proíbe Telegram/Gmail/SMTP e alterações nas configurações de
comunicação.
**Decisão**: `pr_notifications` com tipos fixos (CHECK), prioridade, entidade de
origem, leitura/descarte e teto de 200/dono; TTS apenas por ação explícita do usuário
(Fase 6).
**Consequência**: nenhuma alteração nos canais protegidos; evolução para canais fica
numa camada futura sobre a mesma tabela.

# ADR-EVO-003 — Contratos AgentRun e TaskExecution

**Status:** ACCEPTED · **Data:** 2026-10-30 · **Fase:** 0

## Contexto
Hoje a execução é 1 bot → 1 `runAgent` com teto plano (`server/bots.js:42-141`,
`server/llm.js:294-521`). Runs ficam órfãos em estado `running` para sempre quando a execução é
interrompida (o job vai a `needs_reconciliation`, mas o run não tem estado terminal —
`server/jobs.js:157-171`, gap em `01` §14).

## Problema
Definir os contratos de execução persistentes que suportam hierarquia, orçamento, retomada e
reconciliação sem permitir replay de efeitos externos.

## Opções consideradas
1. Manter runs in-memory e adicionar workaround para órfãos.
2. Contrato persistente `AgentRun`/`TaskExecution` com máquina de estados completa incluindo
   `unknown` + reconciliação explícita.

## Decisão
Opção 2 (`04` §2-4): tabelas `agent_runs` (v20+) com estados
`pending/running/awaiting_approval/completed/failed/cancelled/unknown`; `unknown` só sai por
reconciliação manual com verificador nomeado; `completed` exige evidência
(`execution_evidence.verifiedBy`).

## Racional
- Herda o princípio at-most-once de `jobs.js:158` — estado desconhecido nunca vira re-execução.
- Resolve o órfão eterno: boot marca órfãos como `unknown` (análogo ao `interrupted` de
  aprovações em `db.js:374-389`).
- Permite orçamento hierárquico (sub-orçamento persistido no run, `04` §6).

## Consequências
- Positivas: execução auditável de ponta a ponta; retomada interna por checkpoint.
- Negativas: migração nova e lógica de reconciliação manual a operar (F1.3).

## Implicações de segurança
TH-12/13/20 mitigados; invariantes I6-I8 (`06` §3) viram regras da máquina de estados.

## Alternativas rejeitadas
1 (não escala para hierarquia; mantém o gap).

## Referências
`04` §2-6; `06` §2 (TH-12/13); `server/jobs.js:157-171`; `server/db.js:374-389`; `adr/ADR-EVO-004`.

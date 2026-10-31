# 00 — Sumário Executivo (Fase 1)

**Data:** 2026-10-30 · **Veredito:** **PASS** (detalhes em [`10-PHASE-1-FINAL-REPORT.md`](10-PHASE-1-FINAL-REPORT.md))

## O que foi entregue

A Fase 0 mandava implementar F1.1 (persistência), F1.2 (orçamento hierárquico) e F1.3 (executor
com reconciliação) — e a orquestração da Workforce descrita no mandato da Fase 1. Tudo foi
implementado e testado:

1. **Migração v20** — tabelas `agent_definitions` e `agent_runs` (CHECKs, índices, ownership
   recriado com tipos novos); upgrade de v19 e de banco novo testados, backup verificado.
2. **AgentDefinition** — CRUD completo com ownership obrigatório, validação estrita de escopos
   (recusa `*` e admin-only) e ferramentas (recusa ids desconhecidos), versionamento automático,
   5 templates de especialistas prontos (pesquisa, conhecimento, desenvolvimento, executivo,
   assistente).
3. **AgentRun** — máquina de estados persistente
   (`queued→running→awaiting_approval→completed|failed|cancelled|unknown`) com transições
   validadas atomicamente pelo backend.
4. **Orçamento hierárquico** — `remaining = alloc − usage − Σ(alocado pelos filhos)` avaliado
   dentro de `BEGIN IMMEDIATE`; profundidade, nº de filhos, tamanho da árvore e concorrência
   limitados; recusas tipadas voltam ao modelo como texto.
5. **Execução e recuperação** — checkpoints por passo, idempotência por `(owner, chave)`,
   cancelamento cooperativo, recuperação no boot (órfãos → `unknown`) e reconciliação auditada
   que decide apenas por evidência autoritativa (aprovações D9 correlacionadas + ledger).
6. **Delegação segura** — ferramenta `delegate_agent` no `callTool` com escopo `workforce:run`
   calculado por interseção (pedido ∩ concedido pelo pai); resultado marcado DADO NÃO CONFIÁVEL.
7. **API + UI** — 10 rotas autenticadas sob o dispatcher existente e nova área "Workforce" no
   painel (catálogo, execução, execuções com badges de status/verificação, templates).

## Decisões (nenhum ADR novo necessário)

Todas as decisões desta fase já estavam tomadas nos ADRs da Fase 0 (001–010) e foram seguidas
sem desvios. As duas escolhas de implementação relevantes:

- **Principal do especialista é do tipo `bot`** (identidade tipada criada pelo backend, escopos
  explícitos): reutiliza a classe de confiança existente em `can()` sem abrir nova via de
  identidade. Documentado em [`06`](06-DELEGATION-AND-SECURITY.md).
- **`runAgent` ganhou `agentOverride` opcional** (llm.js): executores internos fornecem o
  "agente" resolvido pelo backend (nome/provedor/modelo/instruções/ferramentas de um
  AgentDefinition) sem tocar na legada `agents`. Parâmetro aditivo; comportamento padrão inalterado.

## Riscos e limitações (honestas)

- Tokens são **estimados** (fórmula da telemetria); `max_tokens` é contabilizado, não enforced
  preventivamente — provider sem relato de uso confiável marca consumo desconhecido.
- `max_retries` é reservado no orçamento, mas o retry automático do executor não foi implementado
  (retries hoje são manuais/reconciliação) — fase seguinte.
- `instruction_checksum` reservado; a integridade de instruções inline não é verificada
  criptograficamente (a verificação de checksum em runtime de skills permanece como item do
  roadmap — TH-03).
- Um run em `awaiting_approval` depende da resolução humana da aprovação D9; o run não se
  re-engancha sozinho após a aprovação (retomada automática → Fase 3, workflows).

## Prontidão da Fase 2 (Personal Knowledge Hub)

Pronta. Pré-requisitos técnicos: nenhum bloqueio — os itens F2.1 (índice híbrido FTS5+vetorial)
e F2.2 (modelo notebook/source/note/insight) partem do schema 20 estável. A Fase 0 recomenda
reduzir dívida residual de lint antes de F3.1; não há dívida hoje (lint limpo).

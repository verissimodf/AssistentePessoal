# ADR-EVO-009 — Evidência, verificação e observabilidade

**Status:** ACCEPTED · **Data:** 2026-10-30 · **Fase:** 0

## Contexto
O sistema já tem: ledger `execution_evidence` (v10) com `verifiedBy` nomeado
(`exit_code`, `contract_text`, `exception`, `not_executed`, `none` — `tools.js:1516-1549`),
auditoria imutável de metadados (v9), telemetria de router em memória (`llm.js:748`) e avaliação
offline versionada (`npm run eval:agents`, CI). A evolução multiplica execuções (delegação,
workflows) — e com elas o risco de alegações não verificáveis (TH-13, TH-20).

## Problema
Como estender evidência e observabilidade para a Workforce/Workflows sem armazenar conteúdo
sensível e sem aceitar auto-relato como prova.

## Opções consideradas
1. Aceitar saída do modelo como registro de sucesso.
2. Persistir prompts/respostas completos para auditoria posterior.
3. Estender o padrão existente: evidência estruturada por passo com verificador nomeado +
   métricas derivadas de metadados, nunca de conteúdo.

## Decisão
Opção 3. Toda transição para `completed` (run, task, workflow step) exige evidência com
verificador nomeado; falsos sucessos são medidos (taxa de false-success = alegados `completed`
sem evidência `verified` / total alegado). Framework de métricas em `03` §3.10 com numerador,
denominador e fonte definidos; **nenhum valor de baseline é inventado** — baselines serão
medidos quando a telemetria persistida (F3.5) existir.

## Racional
- Auto-relato como prova viola TH-13/20; conteúdo completo violaria a política de privacidade
  (audit allowlist `db.js:148-179`, corpos de e-mail nunca persistidos).
- O padrão de verificador nomeado é estendível: novas ferramentas declaram seu verificador na
  TOOL_DEF (`04` §8).

## Consequências
- Positivas: comprovação auditável em todos os níveis; métricas sem PII.
- Negativas: ferramentas novas precisam implementar verificador (custo pequeno e explícito).

## Implicações de segurança
Fecha TH-13 por construção; tamper de evidência continua bloqueado por triggers imutáveis (v9)
e por migrations com backup verificado.

## Alternativas rejeitadas
1 (viola I6); 2 (viola privacidade/retention — dados sensíveis em métrica é anti-requisito).

## Referências
`03` §3.10; `04` §8; `06` §2 (TH-13/20); `server/db.js:309-342`; `docs/EXECUCAO-VERIFICAVEL.md`;
`adr/ADR-EVO-003`.

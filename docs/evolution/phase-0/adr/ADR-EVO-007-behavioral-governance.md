# ADR-EVO-007 — Governança comportamental e enforcement no backend

**Status:** PROPOSED (escopo de adoção em produção exige decisão do dono; caminho padrão
definido) · **Data:** 2026-10-30 · **Fase:** 0

## Contexto
Hoje o comportamento do agente é guiado por instruções do agente/prompt e limitado por controles
executáveis (escopos, D9, hostpolicy). Referência Parlant: guidelines condição→ação avaliadas por
turno, relações exclude/dependency, journeys, canned responses STRICT, explicabilidade
(`07` §4).

## Problema
Como adicionar política comportamental versionada sem que o modelo se torne o mecanismo único de
enforcement (TH-13/14 dependem de que orientação comportamental nunca substitua controle).

## Opções consideradas
1. Apenas prompts/system instructions mais ricas (sem engine).
2. Portar/adotar o Parlant como sidecar.
3. Policy engine interno no backend: guidelines condição→ação versionadas, avaliadas por turno
   antes da montagem do contexto; canned responses para ações críticas; tracing por decisão.

## Decisão (caminho padrão)
Opção 3, na Fase 3 (F3.3/F3.4), **precedida de decisão do dono** sobre escopo (quais ações
recebem política; template STRICT para comandos destrutivos do host). Enquanto não aprovada, o
estado atual (instruções + controles executáveis) permanece.

## Racional
- O motor em Node reutiliza o choke point e o modelo de escopos; o sidecar Parlant (Python,
  infra própria) adicionaria superfície operacional sem necessidade medida (`03` §4).
- Separação explícita: **guidance** (entra no contexto, pode ser ignorada pelo modelo) vs
  **enforcement** (escopos/D9/hostpolicy, não pode ser ignorada). Nenhuma guideline pode criar
  permissão.
- Explicabilidade: política avaliada grava decisão (metadados) para tracing — estende a
  auditoria existente.

## Consequências
- Positivas: comportamento versionado e auditável; reduz falsos sucessos em ações críticas.
- Negativas: custo de manutenção das políticas; risco de conflito entre guidelines (mitigado por
  relações exclude/dependency).

## Implicações de segurança
Reforça invariantes I5/I6; a avaliação de política nunca concede escopo nem pula D9.

## Alternativas rejeitadas
1 (não é verificável nem versionável); 2 (avaliado — `03` §4 — como alternativa futura se escala
justificar).

## Referências
`03` §3.8; `04` §7; `07` §4 (Parlant); `06` §3 (I5, I6); `roadmap.md` (regras de priorização).

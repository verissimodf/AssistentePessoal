# ADR-EVO-005 — Memória episódica, semântica e procedural

**Status:** ACCEPTED · **Data:** 2026-10-30 · **Fase:** 0

## Contexto
Memória atual: entradas por admin com embedding opcional (`tools.js:838-901`), retenção opt-in
com quarentena (v17, `memory-retention.js`), e Gigabrain como store transversal fora do
ownership (`01` §9). O roadmap exige "captura de conhecimento opt-in" com revisão humana.

## Problema
Como estruturar memória para aprendizado contínuo sem transformar inferência do modelo em fato
permanente e sem violar as políticas de privacidade/retenção existentes.

## Opções consideradas
1. Memória única com tags de tipo.
2. Três domínios (episódica/semântica/procedural) com contrato comum de proveniência.
3. Memória automática permanente gerada pelo modelo.

## Decisão
Opção 2 (`05` §1-2): domínios distintos; contrato comum com `origin`, `confidence`, `provenance`,
`kind: fact|hypothesis|inference`; apenas `fact` (humano ou evidência verificada) entra por
padrão no contexto; hypothesis/inference exigem marcação e expiração. Aprendizado procedural só a
partir de execuções com evidência `verified`.

## Racional
- Distinção fato/hipótese é o padrão de "grafo de evidência" do DeepTutor (`07` §1) aplicado a
  dados ownership-scoped.
- Mantém integralmente v17 (opt-in, quarentena, purga) e D_REC; nada automático sem política
  (roadmap 2026-10-27).
- Isola o Gigabrain como fonte externa (untrusted) em vez de store de domínio (`05` §5).

## Consequências
- Positivas: memória auditável e corrigível; risco de "inference rot" limitado por expiração.
- Negativas: mais estruturas por migração (v20+); consolidação episódica exige view nova.

## Implicações de segurança
TH-15 (acesso não autorizado) mitigado por `visibleMemorySql` herdado; conteúdo nunca em audit.

## Alternativas rejeitadas
1 (ambiguidade fato/inferência); 3 (violaria política de captura opt-in e TH-16).

## Referências
`05`; `07` §1 (DeepTutor L1/L2/L3); `server/memory-retention.js`; `roadmap.md` (decisões
2026-10-27); `adr/ADR-EVO-006`.

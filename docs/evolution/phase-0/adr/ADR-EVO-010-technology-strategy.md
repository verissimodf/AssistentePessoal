# ADR-EVO-010 — Estratégia de tecnologia e dependências

**Status:** ACCEPTED · **Data:** 2026-10-30 · **Fase:** 0

## Contexto
As referências da evolução são majoritariamente Python com infra própria (Postgres, Redis,
RabbitMQ, SurrealDB, FalkorDB — `07`). O projeto é Node.js 22 + SQLite (schema 19), local-first,
com regra explícita: "preferir capacidades de bibliotecas/SQLite existentes; nova dependência ou
serviço precisa de benefício medido, custo operacional e plano de recuperação" (`roadmap.md`).

## Problema
Definir critérios estáveis de tecnologia para todas as fases da evolução, evitando decisões
ad-hoc por fase.

## Opções consideradas
1. Replicar a stack das referências (Python + bancos dedicados).
2. Política por fase, com decisão de tecnologia na hora.
3. Política declarativa: manter Node+SQLite como padrão; desvio exige evidência medida.

## Decisão
Opção 3, detalhada na matriz de `03` §4: Node.js permanece; SQLite permanece o único estado
(FTS5 + extensão vetorial embutida para busca; arestas relacionais para grafo;
`durable_jobs` para transporte; motor de workflows/policies interno); provedores LLM permanecem
substituíveis; local-first preservado. Dependências novas permitidas apenas se: (a) sem serviço
novo (biblioteca embutida); (b) benefício medido; (c) plano de recuperação; (d) licença
compatível com uso pessoal/comercial do produto.

## Racional
- Toda infraestrutura atual (19 migrações, backup verificado, healthcheck, rollback por tag) é
  construída sobre essa premissa; desvios multiplicam superfície operacional e de segurança.
- As capacidades pedidas (delegação, workflows, hub, pesquisa) são limites de lógica, não de
  infraestrutura — na escala de um operador.
- O critério de saída está definido (`03` §5): concorrência que degrade o SQLite, CPU de IA
  local competindo com a API, ou exigência de isolamento — nesses casos, perfil Compose isolado
  com socket privado (padrão do browser worker), não banco/rede compartilhada.

## Consequências
- Positivas: superfície operacional constante; revisões de segurança concentradas no código
  próprio; backup/restore únicos.
- Negativas: reimplementação de capacidades que frameworks dariam "de graça" (aceito; escopo
  limitado nos ADRs 004/007).

## Implicações de segurança
Menos serviços = menos limites de confiança novos; cada novo componente de execução isolada
segue o padrão UDS/grants (ADR-EVO-008).

## Alternativas rejeitadas
1 (custo operacional + licenças restritivas + violação local-first); 2 (decisões inconsistentes
entre fases).

## Referências
`03` §4-5; `07`; `roadmap.md` (regras de priorização); `AGENTS.md`; `adr/ADR-EVO-001`.

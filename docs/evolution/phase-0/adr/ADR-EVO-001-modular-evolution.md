# ADR-EVO-001 — Evolução modular versus substituição por framework

**Status:** ACCEPTED · **Data:** 2026-10-30 · **Fase:** 0

## Contexto
A evolução multi-agente poderia ser implementada adotando um framework existente (AutoGPT
platform, LangGraph, Temporal, n8n) ou evoluindo modularmente a base atual (Node 22 + SQLite,
choke point de authz em `server/index.js:1270`, `callTool` com revalidação em
`server/tools.js:1026`, fila durável v16, evidência v10).

## Problema
Escolher a estratégia de evolução sem comprometer os controles de segurança em produção nem a
operação local-first.

## Opções consideradas
1. Adotar framework multi-agente externo como orquestrador.
2. Reescrever o núcleo em outra stack (Python, onde vivem as referências).
3. Evolução modular: novos contextos como módulos/tabelas sobre a base atual.

## Decisão
Opção 3 — evolução modular (ver `03-TARGET-ARCHITECTURE.md` §1-4).

## Racional
- Os controles críticos (identidade de principal, revalidação por execução, ownership, D9,
  evidência nomeada) estão implementados e testados (688+110 testes); um framework externo os
  contornaria ou duplicaria.
- Frameworks das referências são Python com infra própria (Postgres/Redis/RabbitMQ/FalkorDB no
  AutoGPT platform); escala operacional sem evidência de necessidade (regra do roadmap: nova
  dependência precisa de benefício medido).
- PolyForm Shield do AutoGPT platform impede reuso de código para produto concorrente
  (`07` §2).

## Consequências
- Positivas: diff incremental, controles preservados, sem novas dependências de runtime.
- Negativas: o motor de workflows/policies é escrito e mantido internamente (custo aceito,
  escopo limitado nos ADRs 004/007).

## Implicações de segurança
Nenhuma perda de controle; ao contrário, a evolução herda invariávelmente os 14 invariantes de
`06-SECURITY-THREAT-MODEL.md` §3.

## Alternativas rejeitadas
1 (licença + infra + bypass de controles); 2 (reescrita sem justificativa técnica medida).

## Referências
`03` §4 (matriz de tecnologia); `07` (avaliação das referências); `roadmap.md` (regras de
priorização); `adr/ADR-EVO-010`.

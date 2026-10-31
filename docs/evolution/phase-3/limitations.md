# Limitações Reais e Itens Adiados — Fase 3

## Motor

1. **Fan-out simplificado** — após um nó com múltiplas saídas, a execução corre as ondas com
   paralelismo ≤ 2 e segue para o primeiro nó `end`; grafos com joins (múltiplos pais
   aguardando todos) não são suportados — modelos de grafo com join falham na validação? Não:
   são executados seguindo a primeira aresta; documentado como restrição (usar sequência +
   conditions ou subworkflows).
2. **Retomada reavalia condições** — a retomada reconstrói saídas persistidas, mas a caminhada
   volta ao `start` pulando nós concluídos; condições dependentes de saídas funcionam; grafos
   com efeitos colaterais entre branches divergentes não são retomáveis de forma exata (use
   idempotência nas ferramentas).
3. **`wait` máximo = timeout global** — espera maior que `runtime_ms` (10 min) faz o run falhar
   por timeout no próximo tick.
4. **Sem agendamento de início futuro** — workflows iniciam imediatamente; scheduling de
   disparo permanece nos bots (v15/16).

## Aprovações

5. **Sem expiração automática de aprovações** — `expired` não implementado (a aprovação
   pendente aguarda indefinidamente; cancelamento do run a torna órfã de propósito — resolver
   manualmente). Same behavior do D9 existente.
6. **`require_approval` para início de agente/workflow vira negação** — não há objeto D9 para
   "iniciar execução" (ADR-WF-002); usar nós `approval` explícitos dentro do fluxo.

## Policy engine

7. **Condições planas** — `field/op/value` sobre o contexto plano (tool, scope, agent, target);
   sem expressões compostas (and/or aninhados) — múltiplas condições na mesma política são AND.
8. **Sem políticas globais** — por admin (ADR-WF-005).
9. **Cache por admin sem TTL** — invalidado em mutação via API; correção manual no banco exige
   `invalidatePolicyCache`.

## Interface

10. **Editor estruturado** (não visual) — ADR-WF-003; grafo validado no backend.
11. **Sem streaming em tempo real do progresso** — o painel consulta por polling manual
    (botão/refresh); integrar ao NDJSON do chat é evolução posterior.

## Observabilidade

12. **Métricas agregadas** — contagens consultáveis via `wf_events`/audit; não há dashboard de
    séries temporais (a telemetria persistida com retenção permanece item do roadmap).

# ADR-EVO-002 — Identidade, capacidades e permissões de agentes

**Status:** ACCEPTED · **Data:** 2026-10-30 · **Fase:** 0

## Contexto
A Agent Workforce precisa de identidade e permissões para AgentDefinitions/AgentRuns. O sistema
já resolve identidade de forma estrutural: principals só nascem de `validateSession`,
`validateServiceToken` ou `botPrincipal` (`server/auth.js`); `can()` é deny-by-default e bloqueia
wildcard não-verificado (`auth.js:570-576`); `callTool` revalida escopo no momento da execução
(`server/tools.js:1026-1040`); ownership é imutável e filtra todo acesso.

## Problema
Como um agente especializado recebe capacidades sem que a delegação vire escalação de privilégio
(TH-05, TH-06, TH-14 em `06`).

## Opções consideradas
1. Agente carrega suas permissões (token/capability embedding no definition).
2. Orquestrador "empresta" seus escopos aos filhos.
3. Escopos declarados no AgentDefinition são **solicitações**; o backend calcula o conjunto
   efetivo por execução, sob o principal propagado.

## Decisão
Opção 3. AgentDefinition (`04` §1) carrega `permitted_tools`/`permission_scopes` como pedido; o
conjunto efetivo é `requested ∩ granted(principal) ∩ enabled`, calculado e revalidado no backend
a cada `callTool`. Runs filhos propagam o `principal` do pai — nunca criam identidade nova nem
recebem campo de autorização em mensagens (`04` §5).

## Racional
Mantém o choke point único como única porta de autorização; delegação transfere objetivo e
orçamento, nunca permissão. É a mesma invariante que já impede caminhos indiretos (MCP, bots,
Telegram) de burlar rotas.

## Consequências
- Positivos: escalação estruturalmente impossível; auditoria por `correlation_id` cobre a cadeia.
- Negativos: todo recurso novo exige registro em `ownership.TYPES` + `assignNew` na criação —
  regra de processo reforçada (lacuna apontada em `01` §2).

## Implicações de segurança
Fecha TH-05/06/14 por construção; requer teste de isolamento por fase (CONTRIBUTING §risco).

## Alternativas rejeitadas
1 (capability forgery/furto); 2 (confusão de deputy — filho teria mais poder que o delegado real).

## Referências
`04` §1-2, §5-6; `06` §2 (TH-05/06/14) e §3 (I1-I3); `server/auth.js:570`; `adr/ADR-EVO-003`.

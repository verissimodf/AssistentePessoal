# Limitações Conhecidas (Fase 7)

Limitações honestas — nada simulado como se fosse real.

## Gatilhos

- **Sem fontes externas reais** (webhooks, e-mail, calendário): a whitelist registra
  apenas fontes internas que existem no código + `manual` (operador). Integrar fontes
  externas exigiria canais novos — fora do escopo e proibido (integrações protegidas
  intocadas).
- **Gatilhos contextuais** dependem de os módulos reportarem eventos via `recordEvent`;
  hoje o produtor real é o Workflow Engine (sink). Os demais módulos têm a fonte
  registrada, mas poucos produtores — ampliar é aditivo e não exige mudança no motor.
- **Fuso horário**: gatilhos temporais avaliam em UTC (`daily`/`weekly` com hora UTC) —
  documentado; ajuste de fuso local fica para evolução.

## Execução

- **Nível 2 (automação limitada)** inicia apenas workflows de regras marcadas `auto` —
  a classificação de "seguro" é a do operador + políticas; não há classificação
  automática de risco de grafo nesta fase.
- **Parâmetros de regra** (`params_json`) são armazenados mas não injetados
  automaticamente no grafo do workflow (grafo é fixo por versão); personalização de
  entrada por disparo fica para evolução.
- Reconciliação de oportunidades depende do `wf_runs.status` — estados transitórios de
  aprovação mantêm a oportunidade `executing` até o tick seguinte (30 s).

## Notificações

- Internas apenas: **sem** Telegram/e-mail/webhook (proibido pelo mandato §13).
- Sem push no painel: consulta por polling nas rotas existentes.

## Observabilidade

- Métricas são contagens no momento da consulta (sem série histórica); janela horária
  e deduplicações visíveis por consulta ao banco/audit.

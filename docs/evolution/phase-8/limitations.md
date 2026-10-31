# Limitações Conhecidas (Fase 8)

Limitações honestas — nada simulado como integração real.

## Calendário

- **Nenhuma conta real de calendário conectada**: o provider `google` está implementado
  contra a API oficial v3, mas NÃO foi validado com conexão OAuth real nesta fase
  (nenhuma credencial/autorização de usuário disponível — §20). Todo fluxo demonstrado
  usa o provider `fixture`, marcado `provider_test_only: true` em toda a UI/API.
- **Somente leitura**: criar/atualizar/cancelar eventos NO calendário real não está
  implementado (ADR IF-005); a interface conceitual aceita a extensão.
- Sync de apenas um calendário por conta (primary); múltiplos calendários por conta
  ficam para evolução.

## Webhooks

- Sem UI de geração de assinatura para o operador em linguagens variadas — a assinatura
  segue o formato `t=<unix-s>,v1=<hex(hmac-sha256(secret, "t.body"))>` (documentada);
- sem sistema de entrega OUTBOUND (o fabric recebe; não envia webhooks para terceiros).

## Temporal

- Fuso do gatilho é por REGRA (`pr_rules.timezone`) com default do usuário
  (`admin_settings.proactive.timezone`) — récords antigos criados antes da v27 ficam em
  UTC (comportamento preservado, sem migração de dados);
- janela de horário adia a ocorrência inteira (não recorta horário dentro da janela).

## Notificações

- Continuam internas (sem Telegram/e-mail — proibido pelo mandato).

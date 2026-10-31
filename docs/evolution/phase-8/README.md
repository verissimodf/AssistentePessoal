# Fase 8 — Integration Fabric & Temporal Intelligence

Branch: `evolution/phase-8-integration-fabric-20261031` (base: `4c244cc`, Fase 7).

A Fase 8 amplia o J.A.R.V.I.S. para receber eventos externos AUTENTICADOS, normalizá-los
em um contrato canônico, sincronizar calendários por providers abstratos e executar
gatilhos temporais com timezone IANA do usuário (DST correto) — tudo alimentando o
**Proactive Intelligence Engine da Fase 7**, que continua sendo o único mecanismo de
avaliação/recomendação/disparo. Nenhum motor, scheduler ou sistema de autorização novo.

## Fluxo de ponta a ponta

```
HTTP ingress (webhook HMAC) → autenticação → validação de esquema → replay protection
  → aceitação DURÁVEL (202) → [tick assíncrono] normalização → Proactive Engine
  → regra/condição → oportunidade → Workflow Engine → Policy Engine → D9 → resultado
```

## Garantias inegociáveis

1. Webhooks NÃO são confiáveis por padrão: assinatura HMAC-SHA256 com segredo do
   produtor (AES-256-GCM no banco), janela de tempo, replay protection, rate limit.
2. A assinatura AUTENTICA o produtor — não autoriza ação alguma; identidade vem da
   credencial validada no backend (o payload nunca se auto-identifica).
3. Eventos externos são DADOS — nunca instrução, nunca aprovação humana.
4. Execução: só via Workflow Engine (Policy Engine + D9 nativos, intocados).

## Documentos

1. [architecture.md](architecture.md) — arquitetura do fabric e auditoria de reuso
2. [integration-registry.md](integration-registry.md) — registro de integrações
3. [adapter-contracts.md](adapter-contracts.md) — contratos de adaptadores e Calendar Provider API
4. [webhook-ingress.md](webhook-ingress.md) — ingress autenticado (assinaturas, §7.1–7.3)
5. [event-normalization.md](event-normalization.md) — normalização canônica (§8)
6. [idempotency-replay.md](idempotency-replay.md) — idempotência e replay protection
7. [calendar-sync.md](calendar-sync.md) — sincronização, conflitos e reconciliação
8. [temporal-intelligence.md](temporal-intelligence.md) — timezone IANA, DST e recorrências
9. [proactive-integration.md](proactive-integration.md) — integração Proactive/Workflow + ownership/autorização
10. [security-threat-model.md](security-threat-model.md) — segurança e threat model
11. [credentials.md](credentials.md) — gestão de credenciais
12. [observability.md](observability.md) — observabilidade e correlação
13. [api-interface.md](api-interface.md) — API e Integration Studio
14. [testing.md](testing.md) — testes e evidências
15. [limitations.md](limitations.md) — limitações
16. [runbook.md](runbook.md) — runbook
17. [decisions.md](decisions.md) — ADRs IF-001..008

## Providers: real vs teste

| Provider | Estado | Nota |
|---|---|---|
| `fixture` (calendário) | **TESTE** — marcado `provider_test_only: true` em toda a UI/API | demonstra o fluxo completo com fixtures explícitas |
| `google` (calendário) | implementado contra a API oficial (v3 REST) via `oauth_connections` existente | **FUNCIONAL só com conexão OAuth real**; sem conexão: `cal_oauth_not_connected` (indisponibilidade explícita) |
| webhook ingress | **real** (HTTP + HMAC local, sem dependência externa) | — |

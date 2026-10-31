# Normalização Canônica de Eventos (Fase 8, §8)

## Contrato canônico (`normalizeExternalEvent`)

```jsonc
{
  "event_id": "…",           // do corpo (obrigatório)
  "producer_id": "…",        // do BACKEND (produtor autenticado) — nunca do corpo
  "event_type": "deploy.finished",  // ^[a-z][a-z0-9._-]{2,79}$
  "schema_version": "1",     // whitelist: "1", "1.0", "1.1" — versão desconhecida REJEITADA
  "occurred_at": "ISO",      // do corpo; validado (se presente)
  "received_at": "ISO",      // do backend
  "correlation_id": "…",     // do corpo, opcional
  "idempotency_key": "producer:event_id" (ou do corpo, ≤200 chars),
  "payload": { … },          // ≤30 campos escalares; campos de confiança DESCARTADOS
  "trust_level": "authenticated",   // SEMPRE atribuído pelo backend
  "provenance": { "integration": "…", "producer": "nome", "received_via": "webhook_hmac_sha256" }
}
```

## Garantias

- **Validação estrita**: corpo objeto; event_id obrigatório; event_type no padrão;
  schema_version na whitelist (compatibilidade CONTROLADA — versão nova exige código).
- **Classificação de confiança**: `authenticated` só pelo backend (HMAC válido). O
  corpo não pode se promover (chaves `trust_level`, `provenance`, `producer_id`,
  `authenticated` removidas do payload — testado).
- **Proveniência preservada** em `provenance_json` e nas evidências da oportunidade.
- **Payload é DADO NÃO CONFIÁVEL**: nunca instrui agente, nunca altera políticas
  (prompt injection testado — vira evidência/texto, 0 aprovações).
- **Normalização temporal**: instantes em UTC ISO; timezone de origem preservado em
  eventos de calendário.

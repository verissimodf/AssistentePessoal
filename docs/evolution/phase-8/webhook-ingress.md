# Webhook Ingress — Autenticação e Assinaturas (Fase 8, §7)

## Rota

`POST /api/if/webhooks/:producerId` — **pública** (sem cookie/sessão), autenticada por
assinatura HMAC; corpo BRUTO (não confia em Content-Length); resposta rápida após
aceitação durável; processamento assíncrono (tick de 15 s no boot).

## Autenticação (§7.1)

| Requisito | Implementação |
|---|---|
| Assinatura criptográfica | HMAC-SHA256 sobre `"{t}.{corpo-bruto}"` com o segredo do produtor (header `x-if-signature: t=<unix-s>,v1=<hex>`) |
| Comparação em tempo constante | `timingSafeEqual` (buffers de mesmo tamanho) |
| Timestamp e janela | ±5 min (`max_clock_skew_ms`) — fora da janela: `if_timestamp_expired` (401) |
| Identidade pelo backend | o produtor é a CREDENCIAL (segredo HMAC); o payload NUNCA se declara confiável — campos `trust_level`/`producer_id`/`authenticated` do corpo são DESCARTADOS |
| Allowlist de produtores | `allowed_event_types_json` por produtor (`if_event_type_not_allowed`) |
| Tamanho | corpo bruto ≤ 256 KB (`if_payload_too_large`, 413) |
| Rate limiting | 30 eventos/min por produtor (`if_rate_limited`, 429) |
| Auditoria | `if.event_accepted` / `if.webhook_rejected` (código estável; NUNCA payload/segredo) |
| Integração desativada | `if_integration_disabled` (409) — nada processa |

"Não aceitar eventos apenas porque conhecem a URL": sem assinatura válida com o segredo
correto, nada é aceito (produtor forjado testado).

## Fluxo de processamento (§7.2)

```
HTTP ingress → HMAC → esquema (versão/tipo/event_id) → replay (UNIQUE owner+idempotency_key)
  → aceitação DURÁVEL em if_events → 202 → [tick] normalização → Proactive Engine
```

- evento duplicado (mesma `idempotency_key`, mesmo com corpo diferente) → 200
  `deduplicated: true` — o ORIGINAL mantém seu status de processamento (replay não o
  rebaixa nem reprocessa);
- evento inválido é rejeitado e NUNCA inicia workflow;
- concorrência limitada (`max_batch_events` = 25 por tick).

## SSRF e segurança de rede (§7.3)

O ingress apenas RECEBE — não faz fetch orientado por dados externos. Os únicos acessos
de rede do fabric são health checks/sync de calendário contra o PROVIDER CONFIGURADO
(HTTPS fixo da API oficial; sem URL de payload). Sem proxy arbitrário. Loopback/IPs
privados em configurações de URL continuam bloqueados pelo mecanismo existente
(`assertNoContainerIpUrls` no settings; padrão do repo).

# Runbook Operacional (Fase 8)

## Webhook ingress

1. Integration Studio → Integrações → criar integração `webhook` (nome).
2. Criar PRODUTOR: copie o segredo `whsec_…` (exibido UMA VEZ; cifrado no banco).
3. O produtor assina cada evento: `t=<unix-s>,v1=<hex(HMAC-SHA256(secret, "t." + body))>`
   no header `x-if-signature`; corpo ≤ 256 KB; 30 eventos/min.
4. `POST /api/if/webhooks/:producerId` com `event_id`, `event_type` (na allowlist),
   `schema_version: "1"`, `payload`.
5. 202 = aceito (durável); 200 deduplicated = replay; 4xx = rejeitado com código estável.
6. O processamento (regras → oportunidades → workflows) acontece no tick (15 s).

## Calendários

- Provider de TESTE (`fixture`): conectar conta em Integrations → Calendários; injetar
  eventos no fixture e usar "sincronizar" para demonstrar o fluxo (sempre marcado como
  TESTE).
- Provider REAL (google): 1) configurar client OAuth em Configurações (providers); 2)
  conectar a conta Google pelo fluxo OAuth existente (escopo de calendário); 3) ativar a
  integração; 4) sincronizar. Sem conexão: `cal_oauth_not_connected` (indisponibilidade
  explícita).

## Timezone

- Controls (Proactive) → timezone IANA do usuário (ex.: `America/Sao_Paulo`) — usado na
  apresentação e como default para novas regras.
- Regras temporais têm timezone própria (editar regra) — 09:00 local permanece 09:00 nas
  transições de DST.

## Diagnóstico

- `GET /api/if/events` — inspetor (status/error_code por evento);
- `GET /api/if/integrations/:id/test` — saúde por integração;
- `GET /api/pr/metrics` — contagens do motor;
- Auditoria: `if.*` e `pr.*` (dono/ids/estados — nunca payload/segredos).

## Códigos de erro comuns

`if_signature_missing/invalid/mismatch` (401) · `if_timestamp_expired` (401) ·
`if_payload_too_large` (413) · `if_rate_limited` (429) · `if_event_type_not_allowed` /
`if_unknown_schema_version` / `if_missing_event_id` (400) · `if_integration_disabled`
(409) · `cal_oauth_not_connected` / `cal_provider_unavailable` (503).

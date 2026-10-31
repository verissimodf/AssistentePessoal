# Contratos de Adaptadores e Calendar Provider API (Fase 8, §9.1)

## CalendarProvider — interface registrada em código

```js
registerCalendarProvider(name, {
  id, testOnly,                       // testOnly=true: provider de TESTE (nunca "real")
  async healthCheck(account),         // → {ok, ...} — indisponibilidade explícita
  async listEvents(account, { sinceCursor }), // → {events[], cursor, syncTokenHint?}
});
```

CalendarEvent normalizado: `{external_id, title, starts_at_utc, ends_at_utc, timezone,
recurrence[], status: confirmed|cancelled}`.

Operações conceituais do mandato: listar calendários/consultar eventos/consultar
disponibilidade/sincronizar/detectar conflitos — implementadas na camada de sync
(calendar-sync.md). Criar/atualizar/cancelar eventos no provider ficam FORA desta fase
(escopo de escrita no calendário real exigiria autorização dedicada — documentado em
limitations.md; a interface aceita a extensão sem quebra).

## Providers registrados

### `fixture` — TESTE (identificado)
- `testOnly: true` — a UI/API marcam em todo lugar (`provider_test_only`);
- memória do processo com API explícita de fixtures (`__fixture.upsert/cancel/reset`);
- sem rede; demonstra o fluxo completo (sync, dedupe, conflitos, exclusões).

### `google` — API oficial (FUNCIONAL apenas com OAuth real)
- implementado contra Calendar API v3 REST com `getOAuthAccessToken(adminId, 'google')`
  da infraestrutura OAuth EXISTENTE (nenhuma credencial nova);
- **sem conexão OAuth real do usuário → `cal_oauth_not_connected`** (indisponibilidade
  explícita; nunca simulação). Passos para habilitar: configurar client OAuth
  (settings/providers), conectar a conta na UI (fluxo OAuth existente), autorizar
  scope de calendário — documentado no runbook.
- `healthCheck` consulta `/calendars/primary` (10 s timeout).

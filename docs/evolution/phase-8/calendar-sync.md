# Sincronização de Calendários e Conflitos (Fase 8, §9.3)

## Sincronização incremental (`syncCalendarAccount`)

- **Cursor/checkpoint persistido** em `cal_accounts.sync_cursor` (por conta);
- provider devolve apenas mudanças desde o cursor (fixture: fila de mudanças sequenciais;
  google: `updatedMin`/syncToken na API oficial);
- **dedupe**: `UNIQUE(account_id, external_id)` + checksum do evento — nada muda sem
  alteração real (sync repetido → `upserted: 0`);
- **eventos NÃO ordenados**: cada um processado por `external_id` com checksum — ordem de
  chegada é irrelevante;
- **exclusões**: status `cancelled` do provider vence localmente (testado);
- **concorrência**: sync por conta, teto de 500 eventos por sync;
- **recuperação**: cursor sobrevive ao reinício; próxima sync retoma de onde parou.

## Política de conflitos (ADR IF-005)

- Conflito detectado = sobreposição de horários entre eventos `confirmed` da mesma conta
  (varredura por pares; dedupe de conflitos abertos);
- **O PROVIDER vence** (fonte da verdade da agenda): atualizações locais não existem
  nesta fase (sync somente leitura) — nenhuma alteração do usuário é sobrescrita sem
  política explícita;
- Conflitos ficam em `cal_conflicts` para a UI e podem alimentar o Proactive Engine
  (evento `calendar_synced` carrega contagens; regras decidem a recomendação).

## Consistência de timezone

- Instantes SEMPRE em UTC (`starts_at_utc`/`ends_at_utc`);
- timezone de ORIGEM preservada por evento (`cal_events.timezone`);
- a UI apresenta no timezone do usuário (Temporal Settings).

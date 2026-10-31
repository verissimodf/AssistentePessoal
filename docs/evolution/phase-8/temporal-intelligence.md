# Temporal Intelligence — Timezone, DST e Recorrências (Fase 8, §10)

Resolve a limitação da Fase 7 (gatilhos em UTC). Implementação em `server/proactive.js`
(`zonedWallToUtc`, `computeNextRunAt` com `timezone`), coluna `pr_rules.timezone`
(migração v27) e `admin_settings.proactive.timezone` (tz do usuário).

## Garantias (§10.2)

| Garantia | Implementação | Verificação |
|---|---|---|
| não executar duas vezes a mesma ocorrência | chave de ocorrência = horário LOCAL da ocorrência vencida + timezone (`tick:{wall}@{tz}`), dedupe no banco | testes 30/31; demo 18 |
| não perder ocorrência silenciosamente | instante vencido dentro do teto de drift dispara no próximo tick | teste 31 |
| não executar expiradas sem política | ocorrência atrasada > 1 h (`max_occurrence_delay_ms`) é DESCARTADA com motivo auditado (`pr.occurrence_skipped`/`pr_occurrence_stale`) e re-agendada | teste 30 |
| persistir próxima ocorrência | `next_run_at` em UTC no banco | — |
| reconciliar após reinício | tick lê o banco (nada em memória é fonte de verdade) | teste 31 |
| drift do scheduler | próxima ocorrência calculada a partir da ocorrência VENCIDA (sem drift cumulativo) | teste 30 |
| motivo de execução/descarte | auditoria + `skipped` com código estável | — |

## DST (§10.1)

- Instantes persistidos em **UTC**; hora de parede no timezone do usuário;
- **09:00 local continua 09:00** quando o offset muda (prova: Europe/Berlin — CEST
  2026-10-19T07:00Z vs CET 2026-11-02T08:00Z; mesmo `wall`, offsets diferentes);
- **hora inexistente** (spring forward, ex.: 02:30 em 2026-03-29 em Berlin): o algoritmo
  de conversão oscila entre candidatos e aplica a política documentada (ADR IF-006):
  avança 1 h a partir do último candidato — determinístico, nunca perde a ocorrência,
  nunca executa na hora inexistente;
- **hora ambígua** (fall back): primeira ocorrência (horário padrão) — determinística
  (mesma entrada → mesmo instante, testado);
- timezone inválida → `null` (fail-closed: `pr_invalid_timezone` no save; o tick não
  dispara).

## Recorrências suportadas

`daily` (hora local) · `weekly` (dia único OU lista `weekdays` de dias específicos) ·
`monthly` (dia fixo com **clamp** ao último dia do mês — 31/nov → 30) · `interval`
(≥ 60 s) · `date` (única; regra expira após) · **janela de horário** opcional
`window {from,to}` — ocorrência fora da janela local é adiada para o início da janela
(ou da janela seguinte), com motivo.

## Sem scheduler novo

O único mecanismo de agendamento é o tick durável da Fase 7 (`tickProactive`, 30 s) —
estendido com timezone/drift/janela. Nenhum timer em memória como fonte de verdade.

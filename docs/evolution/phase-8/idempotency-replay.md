# Idempotência e Replay Protection (Fase 8)

## Camadas

1. **Replay de HTTP**: janela de timestamp (±5 min) — assinaturas velhas rejeitadas
   (`if_timestamp_expired`); reenvio do mesmo corpo com a MESMA assinatura dentro da
   janela → bloqueado pela idempotência do banco (abaixo).
2. **Idempotência no banco**: `if_events` com `UNIQUE(owner_admin_id, idempotency_key)` —
   o mesmo evento (mesma key, mesmo com corpo diferente) é registrado UMA vez; o replay
   devolve `200 {deduplicated: true}` e NÃO reprocessa (o original mantém seu status).
3. **Dedupe no Proactive Engine**: `recordEvent` com `dedupeKey: if-event:{rowId}` — o
   mesmo evento nunca produz duas oportunidades (UNIQUE owner+key em `pr_events`).
4. **Idempotência de execução**: `startWorkflowRun` com `idempotencyKey: pr-opp:{id}` —
   aceite/disparo repetido não cria segundo run (Fase 7).

## Recuperação (§9.3/§10.2)

- eventos aceitos não processados sobrevivem ao reinício (linhas `received` no banco) e
  são encaminhados no próximo tick — nenhum evento perdido silenciosamente;
- oportunidades `executing` são reconciliadas com a evidência do run (Fase 7);
- contadores de ocorrências temporais usam a chave LOCAL da ocorrência — DST e
  reinícios não duplicam (testes 30/31/integrations).

## Testes que provam

- replay exato → deduplicado (integrations 11-13);
- mesma key com corpo diferente → deduplicado (11-13);
- recover/boot → 1 oportunidade, não 2 (31);
- drift > 1 h → ocorrência descartada COM motivo em auditoria (30).

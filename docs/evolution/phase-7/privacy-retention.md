# Privacidade e Retenção (Fase 7)

## O que é persistido

| Dado | Onde | Retenção |
|---|---|---|
| Regras (e versões) | `pr_rules`/`pr_rule_versions` | vida da regra; versões imutáveis |
| Eventos internos | `pr_events` | metadados de correlação (payloads limitados); dedupe UNIQUE |
| Oportunidades | `pr_opportunities` | histórico de decisões (`decision_json`), evidências |
| Notificações | `pr_notifications` | teto de 200 por dono (corte automático); `expires_at` removido no tick |

## O que NÃO é persistido

- Conteúdo de documentos/pesquisas/memórias: apenas IDs e kinds de correlação;
- Segredos: nenhum (a auditoria registra dono/ids/estados — nunca conteúdo);
- Nada em disco fora do banco; nenhum dado em diretórios públicos.

## Controles

- Todas as leituras filtram por `owner_admin_id` (isolamento por dono);
- Exclusão: regras (e versões) removidas por cascata; notificações descartáveis pelo
  dono; oportunidades têm histórico de decisões mantido para auditoria do dono;
- Dados de áudio/multimodal: fora do escopo do motor (Fase 6 não persiste; Fase 7 não
  toca).

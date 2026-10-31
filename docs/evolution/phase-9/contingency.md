# Plano de Contingência e Recuperação — Fase 9

## Camadas de proteção (existentes)

| Camada | Mecanismo | Evidência |
|---|---|---|
| Backup pré-migração | toda migração faz **backup verificado** do banco antes de aplicar | `server/migrations.js` (contrato v1–v28); `tests/migrations.test.mjs` |
| Transacionalidade | migração aplica em **transação única** — ou tudo ou nada | idem |
| Preservação de dados | preserved-row check após cada migração com cópia | testes de migração por domínio |
| Guardrail de backup | `tests/backup-guardrail.test.mjs` | PASS |
| Aceitação durável de eventos | webhooks persistidos (202) antes do processamento | `tests/integrations.test.mjs` |
| Trilha de auditoria append-only | diagnóstico pós-incidente sem segredos | [observability-audit.md](observability-audit.md) |

## Backup do banco (operação manual)

O mecanismo automático cobre **migrações**. Backup periódico do arquivo do SQLite é
responsabilidade do operador no ambiente de destino:

```bash
# sugerido (com a plataforma parada ou usando o backup do próprio SQLite):
cp <caminho-do-banco.jarvisdb> backup/jarvisdb-$(date +%Y%m%d-%H%M%S)
```

> **Limitação**: a plataforma **não inclui backup automático agendado** — é item de
> prontidão em [production-readiness.md](production-readiness.md).

## Recuperações de boot (automáticas)

Ao reiniciar após queda, a plataforma reconduz automaticamente (exercitado na
demo-final-acceptance):

- runs de workflow incompletos → retomados de forma idempotente;
- aprovações pendentes → correlação aprovação↔run reconstruída
  (`approval-correlation-boot.test.mjs`);
- eventos de webhook aceitos e não processados → processados no próximo tick;
- scheduler de bots/jobs → reconciliado.

**Regra**: a recuperação é por evidência registrada — nunca repetição cega
([reliability-report.md](reliability-report.md)).

## O que fazer em falha de cada subsistema

| Subsistema em falha | Efeito | Ação |
|---|---|---|
| **Banco (SQLite)** | plataforma inoperante | restaurar último backup; migrações re-idempotentes aplicam o que faltar (IF NOT EXISTS + transação); nunca editar migrações já aplicadas |
| **Processo backend** | indisponibilidade total enquanto parado | reiniciar; recuperações de boot atuam; conferir audit para runs interrompidos |
| **STT (whisper.cpp)** | voz→texto indisponível | subir o serviço; plataforma segue operante (indisponibilidade explícita, sem corrupção de estado) |
| **TTS (xtts)** | texto→voz indisponível | similar ao STT; cadeia testada (`tests/voice-tts.test.mjs`) |
| **searxng (research)** | pesquisas falham com código estável | operação restante segue; reexecutar pesquisa depois |
| **Webhook producer** | eventos rejeitados | validar assinatura/janela/replay; rotacionar segredo se comprometido (exibido 1×) |
| **Provider de calendário** | sync falha com código explícito (`cal_oauth_not_connected` p/ Google) | conectar OAuth real ou usar fixture de teste |
| **Browser/CI** | sessões CI indisponíveis | reiniciar worker UDS; sessões reconstituem do banco |
| **Migração com falha** | banco permanece no estado anterior (transação) | diagnosticar o erro; o backup pré-migração é a rede de segurança; reexecutar após correção |

## Princípios de recuperação

1. **Nunca editar migração já liberada** — correção é migração nova.
2. **Nunca repetir cegamente** — diagnosticar pelo audit antes de reexecutar.
3. **Dado corrompido → restaurar**, não "consertar no banco" manualmente (a trilha e
   a imutabilidade do `ownership` são parte da garantia).
4. **Segredo comprometido → rotacionar** (webhook produtor, credenciais OAuth).
5. Falha de dependência externa **nunca** deve ser "resolvida" desativando controles
   (ex.: nunca expor rota para contornar STT ausente).

## Referências

- [runbook.md](runbook.md) — operação e diagnóstico do dia a dia.
- [../phase-8/runbook.md](../phase-8/runbook.md) — integrações.
- [data-migrations-audit.md](data-migrations-audit.md) — mecanismo de migrações.

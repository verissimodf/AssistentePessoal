# Relatório de Confiabilidade — Fase 9

## Princípios consolidados

1. **Recuperação por evidência, nunca por repetição cega**: falha registrada →
   diagnóstico pelo audit/correlação → reexecução consciente. Nenhum subsistema
   "tenta de novo" automaticamente sem registrar o motivo.
2. **Aceitação durável antes de processamento**: webhooks externos são aceitos (202)
   de forma durável e processados por tick assíncrono — uma queda do processo entre
   aceitação e processamento não perde o evento.
3. **Indisponibilidade explícita**: subsistemas com dependência externa ausente
   (STT sem serviço, Google Calendar sem OAuth) falham com código estável e mensagem
   clara — nunca degradam silenciosamente nem fingem sucesso.
4. **Estado reconstituível**: tudo relevante vive no SQLite versionado (v1–v28) com
   migrações transacionais e backup verificado.

## Recuperações de boot por módulo (exercitadas na demo final)

| Módulo | Recuperação de boot | Evidência |
|---|---|---|
| Workflows interrompidos | runs incompletos retomados de forma idempotente | demo-final-acceptance (recuperações de boot) |
| Aprovações pendentes | correlação aprovação↔run reconstruída (`approval-correlation-boot.test.mjs`) | teste + demo |
| Eventos de webhook aceitos | processados no próximo tick (aceitação durável) | `tests/integrations.test.mjs` |
| Jobs/bots agendados | reconciliação do scheduler no boot | `tests/bot-scheduler.test.mjs`, `jobs.js` |
| Sessões multimodais | sessões/turnos inconsistentes marcados e recuperaveis | `tests/multimodal.test.mjs` |
| Conflitos de calendário | reconciliação por evidência (`cal_conflicts`) | demo-final-acceptance |

## Correções estruturais que aumentam confiabilidade

- **Ciclo `bots.js`↔`jobs.js` eliminado** com `setBotRunner` FIRST-WINS: elimina a
  classe inteira de falhas ordem-dependentes no boot (o binding estático antigo
  funcionava, mas o ciclo era frágil a refatorações).
- **`SttError` própria**: erros de STT deixam de ser roteados como erros de mail no
  choke point — diagnósticos e recuperações corretas por domínio.
- **Avaliação de todas as regras irmãs** (`recordExternalEvent`): elimina
  comportamento ordem-dependente (cooldown de uma regra bloqueando irmãs), que
  tornou-se visível com o plano de queries da v28.
- **Índices v28**: ticks periódicos deixam de degradar com o crescimento das tabelas
  (full scan → busca indexada), reduzindo risco de timeouts em ticks longos.

## Regras operacionais

- **Nunca repetir cegamente**: toda reexecução manual deve partir do diagnóstico do
  audit (correlação em [observability-audit.md](observability-audit.md)) e do runbook
  do subsistema ([runbook.md](runbook.md)).
- **Falha de subsistema externo ≠ falha da plataforma**: STT, TTS, searxng e providers
  de calendário são tratados como dependências com indisponibilidade explícita; o
  restante da plataforma segue operante (ver [contingency.md](contingency.md)).

## Limitação de ambiente

Os tempos de recuperação (RTO/RPO) **não foram medidos** nesta fase — o ambiente de
consolidação não é o ambiente de destino. Procedimentos em
[contingency.md](contingency.md); critérios de medição em
[production-readiness.md](production-readiness.md).

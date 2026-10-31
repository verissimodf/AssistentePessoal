# Runbook Operacional Consolidado — Fase 9

Este documento consolida a operação diária e aponta para os runbooks detalhados de
cada fase. Ele não substitui os runbooks específicos — os referencia.

## Runbooks por fase

| Fase | Runbook | Escopo |
|---|---|---|
| 6 | [../phase-6/operations.md](../phase-6/operations.md) | Voz, multimodal, browser |
| 6 | [../phase-6/ui-operations.md](../phase-6/ui-operations.md) | Operação via painel |
| 8 | [../phase-8/runbook.md](../phase-8/runbook.md) | Integrações, webhooks, calendário |
| 8 | [../phase-8/credentials.md](../phase-8/credentials.md) | Credenciais e segredos |

## Operação diária

```bash
./scripts/jarvis.sh            # subir a plataforma (Linux/macOS)
./scripts/jarvis.cmd           # Windows
./scripts/start-local.sh       # ambiente de desenvolvimento
./scripts/testar.sh            # suíte de testes
```

- Painel: navegador no endereço do backend (health em `GET /api/health`).
- Operação dos estúdios: ver [ux-validation.md](ux-validation.md) e runbook da Fase 6.

## Diagnóstico: usar a trilha de auditoria

Toda ação deixa rastro correlacionado (request → agent_run → workflow → approval →
tool → event). Para diagnosticar:

1. **Identifique o domínio do erro** pelo código estável:
   - `cal_oauth_not_connected` → Google Calendar sem OAuth real (esperado sem credencial).
   - Códigos `stt_*` (via `SttError`) → serviço de STT ausente ou falho.
   - Códigos de webhook (`if_*`) → produtor, assinatura ou replay.
2. **Correlacione** na trilha: `principal` → run → aprovação → resultado
   (ver [observability-audit.md](observability-audit.md)).
3. **Não repita cegamente**: reexecute só após entender a causa
   ([reliability-report.md](reliability-report.md)).

## Verificações de rotina

| Verificação | Frequência sugerida | Como |
|---|---|---|
| Health | a cada operação | `GET /api/health` |
| Suíte de testes | após qualquer mudança | `npm test` |
| Backup do banco | antes de qualquer migração (automático) e periodicamente | [contingency.md](contingency.md) |
| Integridade da imagem | a cada release | `./scripts/verificar-imagem-release.sh` |

## Recuperação de subsistemas

| Situação | Ação | Referência |
|---|---|---|
| Processo caiu | reiniciar; recuperações de boot reconduzem runs/eventos pendentes | [reliability-report.md](reliability-report.md) |
| Run de workflow interrompido | recuperação automática no boot; conferir correlação aprovação↔run | [contingency.md](contingency.md) |
| STT indisponível | subir o serviço whisper.cpp; a plataforma continua operante sem voz | [multimodal-validation.md](multimodal-validation.md) |
| Google Calendar "não conectado" | conectar OAuth real do operador (ou usar fixture de teste) | [integrations-validation.md](integrations-validation.md) |
| Webhook rejeitado | conferir segredo do produtor, janela temporal e replay | [../phase-8/runbook.md](../phase-8/runbook.md) |
| Suspeita de dado corrompido | restaurar backup conforme [contingency.md](contingency.md) | [contingency.md](contingency.md) |

## Segredo de produtor de webhook

Exibido **uma única vez** na criação do produtor. Se perdido, rotacionar criando um
novo segredo — ver [../phase-8/credentials.md](../phase-8/credentials.md).

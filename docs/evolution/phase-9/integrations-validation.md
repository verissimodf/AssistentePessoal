# Validação de Integrações — Fase 9

Reavaliação da Fase 8 (Integration Fabric) na consolidação, separando explicitamente
**o que é real** do **que é fixture**.

## Webhook ingress — REAL

| Propriedade | Como é garantida | Evidência |
|---|---|---|
| Autenticação do produtor | HMAC-SHA256 com segredo do produtor (armazenado com AES-256-GCM, **exibido 1×**) | `tests/integrations.test.mjs` |
| Janela temporal + replay protection | timestamps fora da janela e replay são rejeitados | `tests/integrations.test.mjs`; `docs/evolution/phase-8/idempotency-replay.md` |
| Normalização canônica | payload validado contra esquema e normalizado para o contrato canônico antes de virar evento | `docs/evolution/phase-8/event-normalization.md` |
| Aceitação durável | 202 com persistência antes do processamento (tick assíncrono) | `tests/integrations.test.mjs` |
| Rota pública asserida | `POST /api/if/webhooks/:producerId` na lista exata de públicas | `tests/http-auth.test.mjs` |
| Segredo na auditoria | nunca aparece em eventos de audit | demo-final-acceptance |

Cenário E2E na demo-final-acceptance: webhook **aceito** (válido) e **rejeitado**
(assinatura inválida) — ambos auditados.

## Calendário — FIXTURE vs REAL diferenciados

| Provider | Estado | Nota |
|---|---|---|
| `fixture` | **TESTE** — marcado `provider_test_only: true` em toda a UI/API | fluxo completo exercitado: sync, conflitos, timezone IANA/DST, recorrências |
| `google` | implementado contra a **API v3 oficial** via `oauth_connections` | **PENDENTE DE CREDENCIAL** — funcional só com OAuth real do operador; sem conexão, falha explícita com `cal_oauth_not_connected` |

Timezone/DST/recorrências foram validados com dados determinísticos na
demo-final-acceptance (passo timezone/recorrência).

## Outras integrações da base

| Integração | Estado | Autenticação |
|---|---|---|
| AgentMail | real (base) | webhook público com assinatura **Svix** (asserida em `tests/http-auth.test.mjs`) |
| OAuth (genérico) | real (base) | callback público **fail-closed** para state desconhecido |
| searxng (research) | real via `CNC_APP_PROD_01` (F4) | config do operador; indisponibilidade explícita |
| Mail (IMAP/drafts) | real (base) | credenciais cifradas AES-256-GCM |

## Mudanças da F9 no módulo

- Correção do bug de avaliação de regras irmãs em `recordExternalEvent` (ver
  [proactive-validation.md](proactive-validation.md)); regressão nº 36.
- Índices v28 para `if_events(status, id)` e `cal_conflicts(account, resolved)`.
- Nenhuma rota alterada; nenhum contrato quebrado (v28 aditiva).

## Veredicto

Webhook ingress: **PASS (real)**. Calendário: **PASS com fixture / PENDENTE DE
CREDENCIAL para o Google** (classificação completa em [limitations.md](limitations.md)).

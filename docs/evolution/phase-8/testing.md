# Testes e Evidências (Fase 8)

## Suítes executadas (números reais)

| Suíte | Comando | Resultado |
|---|---|---|
| Backend completo | `node --no-warnings --test tests/*.test.mjs` | **847/847 pass** (830 pré-existentes + 17 novos) |
| Frontend (Vitest) | `npx vitest run` | **195/195 pass** (174 pré-existentes + 21 novos) |
| Eval de agentes | `npm run eval:agents` | 6/6 |
| TypeScript | `npx tsc --noEmit` | 0 erros |
| Lint | `npx eslint .` | 0 erros |
| Build | `npm run build` | exit 0 |
| Docker Compose | `docker compose config` | OK |
| Imagem + verificador | `docker build` + `scripts/verificar-imagem-release.sh` | APROVADA (após o commit; schema v27) |
| Links da documentação | varredura de links relativos | 0 quebrados |
| Demo de aceite | `node scripts/demo-fase8.mjs` | 20/20 passos |

## Novos testes backend (`tests/integrations.test.mjs` — 17)

Mandato §17 (backend): registro/ownership de integração (1-3); produtor HMAC com segredo
cifrado e nunca devolvido (4-6); webhook válido 202 com evento durável autenticado e
payload sem auto-identidade (7-10); replay/duplicado por idempotência no BANCO (11-13);
schema inválido, versão desconhecida, tipo não permitido, payload excessivo (14-16);
rate limiting e integração desativada (17-18); integração com Proactive Engine com
proveniência e dedupe de encaminhamento (19-20); calendar fixture — sync incremental,
dedupe, conflito, exclusão (21-22); timezone IANA/DST (23-25); hora inexistente e
ambígua (26-27); recorrências mensais com clamp e janela (28-29); drift com descarte
motivado (30); recuperação de boot sem duplicidade (31); D9 preservado (32-33).

Mandato §17 (segurança): produtor forjado (7-10); HMAC inválido (7-10); timestamp
expirado (7-10); replay (11-13); cross-owner (35, 26 da fase 7); vazamento de
credenciais — segredo uma vez só (4-6); prompt injection é dado (14-16 + 30 da Fase 7);
bypass de D9 (32-33); tempestade (rate limit, 17-18 + 19 da Fase 7).

## Novos testes frontend (`src/test/integrations-ui.test.ts` — 21)

Mandato §17 (frontend): catálogo/configuração (validações de formulário de integração,
conta de calendário e produtor), conexão, ativação/desativação (helpers de badge/estado),
calendário (resumo de sync, conflitos), timezone (`isIANAZone`/`validateIfTimezone`
fail-closed igual ao servidor), histórico/saúde/erros (`ifErrorCode`/`ifErrorCodeLabel`),
janela de assinatura formatada, URL de ingress sem segredo, i18n via chaves `if.*`.

## Demonstração de aceite (§17) — `scripts/demo-fase8.mjs`

Fluxo com workflow REAL (Workflow Engine + Policy Engine + D9 nativos); calendário via
provider FIXTURE identificado (`provider_test_only: true`); nenhuma rede externa.

1. Produtor de webhook registrado ✅
2. Autenticação HMAC-SHA256 configurada (segredo cifrado AES-256-GCM, exibido uma vez) ✅
3. Evento válido aceito (HTTP 202, `authenticated`) ✅
4. Assinatura inválida rejeitada (`if_signature_mismatch`, 401) ✅
5. Replay rejeitado (dedupe no banco por `idempotency_key` UNIQUE) ✅
6. Evento normalizado (producer_id do BACKEND; trust do backend) ✅
7. Encaminhado ao Proactive Engine (assíncrono, forwarded: 1) ✅
8. Regra existente avaliada (fonte `integrations`, condição `ok=true`) ✅
9. Oportunidade com justificativa + 2 evidências de proveniência ✅
10. Workflow REAL iniciado; etapa protegida → `waiting_approval` ✅
11. D9 demonstrado: aprovação `pending` → nada executa sem humano; aprovada → `completed` ✅
12. Provider de calendário FIXTURE conectado (marcado como TESTE) ✅
13. Eventos importados com timezone definido (instantes em UTC) ✅
14. Conflito detectado (sobreposição) ✅
15. Recorrência semanal 09:00 local em Europe/Berlin preservada ✅
16. DST comprovado: 2026-10-19T07:00Z (CEST) vs 2026-11-02T08:00Z (CET); hora inexistente
    (02:30 spring forward) avança p/ 03:30 local — nunca perde, nunca duplica ✅
17. "Reinício" do processo → ocorrência temporal processada ✅
18. Recuperação sem duplicidade (1 oportunidade; dedupe por ocorrência local @tz) ✅
19. Integração desativada ✅
20. Novo evento → rejeitado `if_integration_disabled` (409) ✅

Métricas observadas: 6 eventos recebidos, 2 oportunidades, 1 workflow iniciado,
1 conclusão, 0 falhas, 4 notificações.

## Reprodutibilidade

```bash
node scripts/demo-fase8.mjs                                  # demo de aceite
node --no-warnings --test tests/integrations.test.mjs        # suíte da fase
npx vitest run src/test/integrations-ui.test.ts              # testes de UI
```

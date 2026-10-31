# Testes e Evidências (Fase 7)

## Suítes executadas (números reais)

| Suíte | Comando | Resultado |
|---|---|---|
| Backend completo | `node --no-warnings --test tests/*.test.mjs` | **830/830 pass** (807 pré-existentes + 23 novos) |
| Frontend (Vitest) | `npx vitest run` | 148 pré-existentes + novos do Proactive Studio (número final no relatório executivo) |
| Eval de agentes | `npm run eval:agents` | 6/6 |
| TypeScript | `npx tsc --noEmit` | 0 erros |
| Lint | `npx eslint .` | 0 erros |
| Build | `npm run build` | exit 0 |
| Docker Compose | `docker compose config` | OK |
| Imagem + verificador | `docker build` + `scripts/verificar-imagem-release.sh` | APROVADA (executada após o commit) |
| Links da documentação | varredura de links relativos | 0 quebrados |

## Novos testes backend (`tests/proactive.test.mjs` — 23)

Mandato §17 (backend): CRUD e ownership (1-3, 4, 26); validação de regras (1-3);
versionamento com snapshots imutáveis (4); gatilho temporal com tick idempotente (20);
gatilho por evento com dedupe/replay (8-10); motor de condições — operadores, AND/OR/
NOT, tipos, ausência de dados, limites com violação terminal, sem eval (5-7); condições
não satisfeitas com razão e nenhuma oportunidade (21); deduplicação (8-10); idempotência
do aceite (12-13); limites — cooldown, max_executions com desativação e notificação
(18); tempestade de eventos (19); cancelamento do run → falha reconciliada (24);
recuperação de boot com evidência do run (23); execução de workflow REAL (12-13);
integração com D9 — etapa protegida espera aprovação humana mesmo em automação de
nível 2 (14-15); integração com Policy Engine — deny bloqueia com fail-closed (25);
notificações — tipos, leitura, descarte, teto (17, 27); isolamento entre usuários (26).

Mandato §17 (segurança/adversarial): evento forjado rejeitado (11); tempestade (19);
replay (8-10); nível 0 bloqueia até o aceite (16); pausa global e por regra (17);
prompt injection no payload é dado — nenhuma aprovação criada (30); escopos nunca de
bot (28); métricas reais (29); teste sem efeitos colaterais (22).

## Demonstração de aceite (§17) — `scripts/demo-fase7.mjs`

Fluxo REAL (Workflow Engine + Policy Engine + D9 nativos; evento via fonte `manual`/
`research` da whitelist; nenhuma rede externa). Resultado observado:

1. Regra proativa criada (`draft`) ✅
2. Gatilho por evento interno (`research`/`research_completed`) ✅
3. Condição configurada e validada no save ✅
4. Evento interno produzido pela fonte autorizada ✅
5. Condição avaliada (nível 1 — recomendação) ✅
6. Oportunidade criada ✅
7. Recomendação com justificativa + 2 evidências ✅
8. Aceite humano → workflow REAL iniciado ✅
9. Etapa segura executada; etapa protegida → `waiting_approval` ✅
10. Aprovação D9 pendente correlacionada ✅
11. Bloqueio confirmado (nada avança sem humano) ✅
12. Notificação `approval_needed` emitida ✅
13. Aprovação humana (canal D9; resolução simulada no padrão dos testes wf-engine;
    fingerprint exigido na resolução real pela UI) → execução retomou ✅
14. Run terminal `completed` ✅
15. Oportunidade reconciliada pela evidência do run ✅
16. Trilha completa event→rule(v1)→opp→run→approval→resultado ✅
17. Replay do evento → deduplicado; `pr_duplicate` — nada executou de novo ✅
18. Regra pausada → novo evento NÃO inicia execução ✅

Métricas observadas na demo: 6 eventos, 1 oportunidade, 1 run, 1 conclusão,
0 falhas, 5 notificações, 5 eventos de auditoria `pr.*`.

## Reprodutibilidade

```bash
node scripts/demo-fase7.mjs                                # demo de aceite
node --no-warnings --test tests/proactive.test.mjs         # suíte da fase
```

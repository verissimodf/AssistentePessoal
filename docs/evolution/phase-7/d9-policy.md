# D9 e Policy Engine (Fase 7, §10 — inegociável)

## As 10 regras obrigatórias → implementação e verificação

| # | Regra | Implementação | Verificação |
|---|---|---|---|
| 1 | Aprovação não é inferida de execução anterior | nenhum estado do motor concede escopo; cada run protege suas próprias etapas | teste 14-15 |
| 2 | Rotina recorrente não herda aprovação indefinidamente | cada disparo cria run NOVO; etapas protegidas param em `waiting_approval` de novo, a cada ocorrência | teste 20 + 14-15 |
| 3 | Aprovação vinculada a ação/contexto/fingerprint | mecanismo D9 existente intocado (`approval_actions` com fingerprint) | regressão Fase 3/5 |
| 4 | Contexto alterado invalida aprovação | revalidação de políticas a cada início; D9 nativo revalida na resolução | regressão |
| 5 | Autorização verificada no backend imediatamente antes da execução | `startWorkflowRun` → `evaluatePolicies` no momento do início; `callTool` revalida na execução | teste 25 |
| 6 | Falha na verificação bloqueia | `wf_policy_denied` → oportunidade `failed` + notificação (fail-closed) | teste 25 |
| 7 | Recomendação não vira execução sem autorização | nível 1 exige aceite; aceite ≠ aprovação de etapas protegidas (D9 separado) | testes 12-13, 14-15 |
| 8 | Agente não concede permissões a si mesmo | sem ferramenta nova; `proactive:*` fora de `BOT_SCOPES`/`DEFAULT_BOT_SCOPES` | teste 28 |
| 9 | Gatilho automático ≠ consentimento humano | nível 2/3 inicia run, mas D9 das etapas protegidas permanece humano | teste 14-15 |
| 10 | Rastreabilidade regra→oportunidade→workflow→aprovação→resultado | `getExecutionTrail` (correlação completa) | teste 12-13 |

## Conclusão

Nenhum caminho alternativo de autorização foi criado. O motor proativo decide QUANDO
propor/iniciar; o Policy Engine decide SE pode; o D9 decide SE a etapa protegida executa.

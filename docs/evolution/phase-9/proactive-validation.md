# Validação Proativa — Fase 9

Reavaliação da Fase 7 (Proactive Intelligence) na consolidação.

## Modelo de funcionamento (inalterado)

```
regra (versionada, owner, nível 0–3) → gatilho (evento/temporal)
  → avaliação → oportunidade (justificativa + evidências)
    → notificação interna → aceite humano → workflow
```

O Proactive Engine é o **único mecanismo** de avaliação/recomendação/disparo da
plataforma (fases 8 e 9 não criaram motores paralelos) — regras da Fase 8 apenas
alimentam gatilhos de evento.

## Verificações reauditadas na F9

| Capacidade | Como é garantida | Evidência |
|---|---|---|
| Regras versionadas | migração v26; edição cria versão, nunca reescreve histórico | `tests/proactive.test.mjs` |
| Justificativa + evidências | toda oportunidade nasce com justificativa e evidências registradas | demo-fase7; demo-final-acceptance |
| Níveis 0–3 | agressividade por regra; níveis maiores exigem mais confirmação | `tests/proactive.test.mjs` |
| Pausa | regras podem ser pausadas sem perder versões | `tests/proactive.test.mjs` |
| Cooldown | por regra; **nunca** vaza para regras irmãs (pós-F9) | regressão nº 36 |
| Notificações internas | `pr_notifications` por owner, com leitura rastreada (índice v28) | demo-final-acceptance |
| Nunca auto-executar | oportunidade exige aceite humano; execução é sempre via Workflow Engine (D9/Policy) | demo-final-acceptance (regra→evento→oportunidade→aceite→workflow) |

## Bug das regras irmãs — corrigido na F9

**Sintoma**: `recordExternalEvent` (que alimenta o Proactive Engine com eventos do
Integration Fabric) avaliava apenas a **primeira regra** que casava com o evento. Se
essa regra estivesse em cooldown, as regras irmãs que casavam com o mesmo evento não
eram avaliadas — comportamento dependente da ordem das regras.

**Correção**: o avaliador processa **todas** as regras que casam, cada uma com seu
próprio cooldown.

**Evidência**: teste de regressão **nº 36 em `tests/integrations.test.mjs`**. O bug só
se manifestava de forma perceptível com o novo plano de consultas introduzido pela
migração v28 — por isso foi detectado nesta fase, não na F8.

## Números

- demo-fase7: aprovada na sua fase; os cenários proativos foram re-exercidos na
  demo-final-acceptance (37/37).
- Suíte proativa (`tests/proactive.test.mjs`) verde na regressão 848/848.

## Limitações

- Nenhuma limitação nova introduzida pela F9.
- Limitações herddas da F7 (ex.: sem canais externos de notificação — notificações são
  internas à plataforma) permanecem conforme documentado em
  [limitations.md](limitations.md).

# Níveis de Autonomia (Fase 7, §10)

## Os quatro níveis

| Nível | Nome | O que o motor faz | O que NUNCA faz |
|---|---|---|---|
| 0 | **Observação** | registra eventos; avalia condições | não cria oportunidade, não executa |
| 1 | **Recomendação** (padrão) | cria oportunidades com justificativa; notifica | não inicia nada sem aceite humano |
| 2 | **Automação limitada** | além de (1): inicia AUTOMATICAMENTE workflows de regras `execution:'auto'`, dentro de limites/cooldown/dedupe | não pula D9; não amplia escopo |
| 3 | **Execução condicionada** | além de (2): mesma execução com D9 nativo para etapas protegidas | não aprova; aprovação segue humana |

## Regras duras (verificadas por teste)

1. O nível configurado **nunca** sobreponhe o Policy Engine ou as restrições de
   segurança: nível 3 com política `deny` → bloqueado (teste 25).
2. Nível é configuração **por admin** (`admin_settings.proactive.level`), com ownership
   e validação no backend (`validateControls`; `pr_invalid_level` para fora de 0–3).
3. Gatilho automático não é consentimento: nível 2/3 inicia o RUN; etapas protegidas
   dentro dele continuam parando em `waiting_approval` com D9 real (teste 14-15).
4. Nível 0 bloqueia até o aceite humano de oportunidades (nada nasce).
5. Pausa global (`paused`) e pausa por regra param tudo acima da observação (teste 17).

## API dos controles

`GET/PUT /api/pr/controls` — `{level, paused, maxExecutionsPerHour, cooldownMs,
maxPendingOpportunities}`. Defaults: nível 1 (recomendação), sem pausa, 10 execuções/h,
cooldown 60 s, 50 pendentes. Valores fora da faixa → default seguro (não erro de estado).

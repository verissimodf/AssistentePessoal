# API e Proactive Studio (Fase 7, §13–14)

## API `/api/pr/*` (todas autenticadas; escopos `proactive:read`/`proactive:write`)

| Grupo | Rotas |
|---|---|
| Regras | `GET/POST /api/pr/rules`, `GET/PUT /api/pr/rules/:id`, `POST …/activate|pause|resume|disable|test|run` |
| Eventos | `GET /api/pr/events?limit=` (leitura; produção é interna + `manual` via motor) |
| Oportunidades | `GET /api/pr/opportunities`, `GET /:id`, `GET /:id/trail`, `POST /:id/accept|dismiss|snooze` |
| Notificações | `GET /api/pr/notifications?unread=1`, `POST /:id/read`, `POST /:id/dismiss` |
| Controles | `GET/PUT /api/pr/controls` (nível, pausa global, limites) |
| Métricas | `GET /api/pr/metrics` |

Erros estáveis: `pr_name_required`, `pr_invalid_trigger_*`, `pr_invalid_conditions`,
`pr_invalid_execution`, `pr_invalid_state`, `pr_invalid_transition` (409),
`pr_invalid_level`, `pr_invalid_source`, `pr_event_storm` (429), `pr_rule_limit` (429),
`not_found` (404 uniforme cross-owner).

## Proactive Studio (`src/routes/proactive.tsx`)

Cinco áreas integradas ao painel (sem interface paralela ao Workflow Studio — a
execução permanece lá):

1. **Dashboard** — métricas reais, notificações recentes, estado geral (nível, pausa);
2. **Rules** — CRUD com gatilho (evento: fonte+kind; temporal: daily/weekly/interval/
   date), editor de condições (grupos all/any, folhas op/fact/value), workflow alvo,
   limites; ativar/pausar/retomar/desativar; **teste sem efeitos**; versões;
3. **Opportunities** — recomendações com justificativa e evidências visíveis; aceitar
   (inicia o workflow real), ignorar (com motivo), adiar;
4. **Executions** — histórico com trail de correlação (run, aprovações, resultado);
5. **Controls** — nível de autonomia (com descrição honesta dos 4 níveis e do limite
   "nunca sobreponhe Policy Engine/D9"), pausa global, limites operacionais.

Estados vazios e de erro em todas as seções; acessibilidade (labels/aria); responsivo;
i18n pt/en/es (chaves `pr.*`).

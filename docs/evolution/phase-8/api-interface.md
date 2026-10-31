# API e Integration Studio (Fase 8, §13–14)

## API `/api/if/*` (escopos `integrations:read`/`integrations:write`; ingress público com HMAC)

| Grupo | Rotas |
|---|---|
| Catálogo | `GET /api/if/catalog` (definições em código: kinds, capacidades, providers) |
| Integrações | `GET/POST /api/if/integrations`, `GET /:id`, `POST /:id/activate|disable|test` |
| Produtores | `POST /api/if/integrations/:id/producers` (segredo UMA vez), `GET …/producers` (sem segredos) |
| **Webhook ingress** | `POST /api/if/webhooks/:producerId` — público, HMAC-SHA256, 202/200/4xx |
| Event inspector | `GET /api/if/events?limit=` |
| Calendários | `GET/POST /api/if/calendar/accounts`, `GET /:id`, `POST /:id/sync`, `GET /:id/events`, `GET /:id/conflicts` |
| Temporal | `GET/PUT /api/pr/controls` (timezone IANA do usuário), regras com `timezone`/`next_run_at` em `GET /api/pr/rules` |

## Integration Studio (`src/routes/integrations.tsx`)

Cinco áreas integradas ao painel (nenhum segundo painel de automação — regras ficam no
Proactive Studio):

1. **Integrações** — catálogo, criar/configurar, ativar/desativar/testar conectividade,
   saúde, produtores com aviso de segredo único;
2. **Webhooks** — produtores autorizados, eventos recebidos (produtor, tipo, horário,
   proveniência, estado, resultado), rejeições com código estável;
3. **Calendários** — contas (badge PROVIDER DE TESTE quando fixture), sync com contagens,
   eventos, conflitos, indisponibilidade explícita do provider real;
4. **Temporal Settings** — timezone do usuário, recorrências, próxima execução;
5. **Event Inspector** — proveniência e correlação (integração → produtor → evento →
   regra → oportunidade → run).

Estados vazios e de erro em tudo; acessibilidade; responsivo; i18n pt/en/es (`if.*`).

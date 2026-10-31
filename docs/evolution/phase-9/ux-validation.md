# Validação da Experiência Unificada — Fase 9

## Panorama

O painel (React/Vite/TanStack) concentra a operação da plataforma em **11
estúdios/painéis**, todos falando com o backend exclusivamente via `src/lib/bridge.ts`
(único canal HTTP), com fallback demo em localStorage para uso sem servidor.

| Estúdio/Painel | Fase | Função |
|---|---|---|
| Painel principal / conversas | Base | Chat, runs, aprovações |
| Agent Workforce | F1 | Delegação, orçamento, workforce |
| Knowledge Hub | F2 | Ingestão, busca, citações |
| Workflow & Behavior Studio | F3 | Fluxos, aprovações obrigatórias, políticas |
| Research & Learning | F4 | Pesquisas profundas e aprendizados |
| Computer Intelligence | F5 | Sessões de browser isolado, D9 |
| Multimodal / Voz | F6 | Sessões de voz, turnos, avatar |
| Proativo | F7 | Regras, oportunidades, notificações |
| Integrações | F8 | Produtores de webhook, calendários |
| Diagnósticos | Base | Saúde do sistema |
| Administração | Base | Admins, settings, segurança |

## Consistência verificada

- **Navegação consistente**: os 11 estúdios seguem o mesmo padrão de layout e
  navegação herdado da base — nenhum estúdio novo introduziu padrão próprio de rota
  ou menu.
- **i18n pt/en/es**: os três idiomas permanecem completos nos estúdios novos
  (fases 5–8); strings não traduzidas caem no fallback do idioma base (comportamento
  herddo, não alterado pela F9).
- **Fallbacks**: com backend ausente, o painel opera em modo demo com dados locais
  (`bridge.ts`) — mesmo comportamento validado desde a base.
- **Indisponibilidades honestas na UI**: provedores de calendário de teste marcados
  `provider_test_only: true` em toda a UI/API; STT e Google Calendar exibem estado
  de indisponibilidade explícito (não simulam funcionar).

## Impacto da F9 na UI

- Remoção de **28 componentes mortos** em `src/components/ui/` (sem importação viva)
  e **25 dependências mortas** — nenhum componente em uso foi tocado.
- Suíte frontend **195/195** verde e `tsc` com 0 erros após as remoções — a remoção
  não alterou nenhuma tela.

## Como validar localmente

```bash
npm test                 # 195/195 frontend + 848/848 backend
npx tsc --noEmit         # 0 erros
npm run build            # build do painel
```

## Limitações de validação

A validação da F9 é **de código e de suíte** (testes, tipos, build). A inspeção
visual interativa dos 11 estúdios no navegador é tarefa do operador no ambiente de
destino; o cenário de navegador da demo final (CI observe) é automatizado, não visual.

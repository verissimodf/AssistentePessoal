# Integração com a Workforce (agentes)

## O que os agentes têm acesso

Os agentes da Workforce executam ferramentas via `callTool` com os escopos concedidos na
definição do agente (`permitted_tools`/`permission_scopes`, `server/workforce.js:129,
157-158`). O catálogo de ferramentas é o `TOOL_DEFS` de `server/tools.js` — e
`browser_action` faz parte dele (`server/tools.js:122-131`):

> "Automação de navegador (Playwright). Operações permitidas: navigate, extract, click,
> fill, wait_for, screenshot. Sem shell e sem download; destino validado por política de
> rede; exige aprovação humana."

Ou seja: um agente pode disparar ações de navegador isoladas, e elas passam pelo **mesmo**
portão D9 usado pelo motor CI (`server/tools.js:1412-1451`). Não existe ferramenta CI
própria (nada como `ci_open_session`/`ci_execute_plan`) exposta no `TOOL_DEFS` — o motor de
sessões/planos não é invocável por agentes; o acesso é pelas rotas `computer:*` no painel.

## Non-escalation

- `browser_action` exige escopo `web` e, para `click`/`fill`, **`web:write`** — escopo
  calculado em tempo de execução dentro do `callTool`
  (`server/tools.js:1052-1055`, `server/auth.js:98`). Um agente sem `web:write` consegue
  observar (extract/screenshot/wait_for) mas não escrever.
- O Policy Engine (Fase 3) se aplica igualmente ao agente: `deny` bloqueia, `force_approval`
  degrada autonomia (`server/tools.js:1066-1082`).
- Toda escrita do agente exige resolução humana com `confirmWrite + fingerprint` para
  click/fill (`server/tools.js:1692-1696`) — o agente nunca aprova a própria ação.
- O principal interno do motor CI (`bot ci:<sessionId>` com `web/web:write/kh:read`,
  `server/computer.js:286`) é construído pelo próprio motor no `callTool`; ele não é
  atribuível a definições de agente nem amplia escopos de terceiros.
- Ferramentas proibidas para agentes não fazem parte do catálogo: o motor CI completo
  (sessões, planos, tick, procedimentos) fica atrás dos escopos `computer:read/run`
  (`server/auth.js:59-60`), que são escopos de token/sessão humana nas rotas
  (`server/index.js:1415-1479`) — nenhum caminho do Workflow/Workforce invoca
  `server/computer.js`.

## Resumo

| Superfície | Acesso do agente |
|---|---|
| `browser_action` (ação avulsa, D9 por pedido) | Sim, se `web`/`web:write` nos escopos do agente |
| Motor CI (`openSession`, `planActions`, `executePlan`, tick) | Não — não há ferramenta exposta |
| Procedimentos CI (`recordProcedure`, `reuseProcedure`) | Não — só rotas `computer:*` |

Consequência prática: a autonomia de agentes em navegador permanece no nível por-ação
preexistente; a Fase 5 não concedeu aos agentes novos poderes de sessão/planejamento.

# Decisões Técnicas — Fase 5

## ADR-CI-001 — Computer Intelligence sobre o worker Playwright existente (sem desktop nativo)

**Status:** ACCEPTED · **Contexto:** ADR-EVO-008 (Fase 0) condicionava automação GUI nativa à
decisão de produto e isolamento. **Decisão:** o ambiente da Fase 5 é o NAVEGADOR (worker
Playwright isolado, UDS, D9 por ação) — nenhum controle de desktop nativo (teclado/mouse/janelas)
foi implementado. **Consequências:** fronteira de segurança existente reutilizada integralmente;
GUI nativa segue adiada para decisão de produto futura.

## ADR-CI-002 — Observação de leitura direta; escrita sempre via callTool/D9

**Status:** ACCEPTED · **Contexto:** via `callTool`, TODA ação de navegador enfileira D9 —
impraticável para o loop de observação (leitura de baixo risco) e correto para escritas.
**Decisão:** `observe` usa `runBrowserAction` direto (destino validado, auditado, escopo
`computer:read` na sessão); navegação/click/fill vão via `callTool` (política + `web:write` + D9).
**Consequências:** observação fluida; escritas human-in-the-loop; nenhuma via nova de execução.

## ADR-CI-003 — Evidência visual via base64 no UDS (protocolo do worker estendido)

**Status:** ACCEPTED · **Contexto:** o worker só devolvia o TAMANHO do screenshot (a imagem era
descartada); o worker é read_only sem volume. **Decisão:** protocolo estendido com
`screenshotBase64` (cap de tamanho) — a imagem volta pelo socket Unix (canal de confiança
app↔worker) e o app persiste o artefato em `data/ci/<session>/` com retenção (remoção no
fechamento). **Consequências:** requer rebuild da imagem do worker (`Dockerfile.browser`) na
próxima release; profile permanece opt-in/desligado.

## ADR-CI-004 — Aprovação D9 ≠ verificação de resultado

**Status:** ACCEPTED · **Contexto:** aprovar uma ação não prova que o efeito desejado ocorreu.
**Decisão:** o tick resolve ações pendentes verificando pelo CRITÉRIO do plano
(`expected_json`: text_present/url_contains) contra uma observação PÓS; sucesso/falha/divergência
são estados distintos com evidências antes/depois. **Consequências:** falso-positivo estrutural
eliminado no caminho automatizado.

## ADR-CI-005 — Bloqueio embutido de categorias proibidas (sem bypass)

**Status:** ACCEPTED · **Contexto:** mandato §9.3 proíbe pagamento/compra/transferência/envio/
exclusão irreversível autônomos. **Decisão:** `PROHIBITED_PATTERNS` no backend avalia o alvo de
CADA ação antes da execução — bloqueado (`ci_prohibited_action`) mesmo que a página, o plano ou
o agente solicitem; sem flag de bypass nesta fase. **Consequências:** conservador; um futuro
"modo permitido" exigiria decisão de produto + ADR.

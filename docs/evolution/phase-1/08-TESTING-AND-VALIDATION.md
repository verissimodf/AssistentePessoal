# 08 — Testes e Validação (Fase 1)

Resultados reais, executados em 2026-10-30 na branch
`evolution/phase-1-agent-workforce-20261030`.

## 1. Suítes novas (Workforce)

| Arquivo | Testes | Cobertura |
|---|---|---|
| `tests/workforce-migration.test.mjs` | 7 | v20 em banco limpo; snapshot/backup íntegros; idempotência; upgrade v19→v20 com preservação de ownership; CHECKs (status inválido, tipo de ownership); trigger de imutabilidade; UNIQUE (owner,name) e índice parcial de idempotência |
| `tests/workforce-core.test.mjs` | 12 | CRUD de definitions com ownership/versionamento/imutabilidade; validação de escopos/ferramentas/limites; 5 templates; execução com consumo + evidência; idempotência de run; D9 pending → awaiting_approval; cancelamento cooperativo + terminal intocado; crash → failed; boot → unknown; reconciliação (not_executed / awaiting_approval / recusa de re-reconciliação); paginação e isolamento de leitura; delegação com interseção de escopos + sub-orçamento + limite de profundidade; limite de filhos; orçamento à prova de concorrência (alocações paralelas ≤ pai) |
| `tests/workforce-security.test.mjs` | 6 | E2E HTTP real (porta efêmera): 401 sem sessão; CSRF 403; criação com ownership; isolamento total entre duas admins (404 uniforme em get/cancel/reconcile, lista sem cruzamento); idempotência na API; disabled → 409; body inválido → 400; principals forjados sem `workforce:run`; delegação de bot sem escopo negada; reconciliação nunca inventa sucesso (`confirm` sem evidência → 409 ou failed/not_executed, nunca completed) |

Total: **25 testes novos** (node --test).

## 2. Regressão completa (obrigatória)

| Checagem | Comando | Resultado |
|---|---|---|
| Backend completo | `node --no-warnings --test tests/*.test.mjs` | **713/713 pass, 0 fail** (688 pré-existentes + 25 novos) |
| Frontend completo | `npx vitest run` | **113/113 pass** (110 pré-existentes + 3 novos em `src/test/workforce-ui.test.tsx`) |
| Avaliação agêntica | `npm run eval:agents` | **6/6 cenários exit 0** |
| TypeScript | `npx tsc --noEmit` | exit 0 |
| Lint | `npm run lint` (`eslint .`) | limpo (0 erros, 0 avisos) |
| Build de produção | `npm run build` | exit 0 |
| Config Docker | `docker compose config -q` | OK |
| Imagem + verificador de release | `docker build` (tag de verificação) + `scripts/verificar-imagem-release.sh` | **APROVADA** — labels OCI, health, painel HTTP 200 (container descartável; produção intocada) |

## 3. Correções em testes pré-existentes (não enfraquecimento)

- `tests/migrations.test.mjs` ("v19 encrypts…"): a versão final do migrate era **hardcoded 19**;
  agora usa `targetVersion()` — o teste continua validando a cifra in-loco e a preservação, e
  passa a acompanhar o topo real do schema. Nenhuma asserção de segurança removida.
- `tests/diagnostics.test.mjs`: contagem de ferramentas 21 → 22 (delegate_agent) — o teste
  exige cobertura EXATA entre TOOL_META e TOOL_DEFS; a entrada nova em `TOOL_META`
  (`server/diagnostics.js`) documenta portão/limites/testes da delegação.

## 4. Categorias obrigatórias × realizado

| Categoria (mandato §12) | Onde |
|---|---|
| Banco (migração, FK, unique, concorrência de criação, invalid data) | `workforce-migration` + `workforce-core` |
| Definitions (ownership, imutável, disabled, inválidos) | `workforce-core` |
| AgentRun (root/child, transições, checkpoints, histórico) | `workforce-core` |
| Delegação (profundidade, filhos, escopos, escalada) | `workforce-core` + `workforce-security` |
| Orçamento (alocação, concorrência, exaustão, cancelamento) | `workforce-core` |
| Execução (sucesso, falha, unknown, reconciliação, duplicata, cancelamento) | `workforce-core` + `workforce-security` |
| Segurança (cross-user, forjados, evidência, autorização) | `workforce-security` |
| Integração (cenário completo com agregação e evidência) | parcial — cenários de delegação 1 especialista + agregação em `result.children`; variantes de falha cobertas; smoke E2E multi-especialista completo fica como item de follow-up (ver `09` §limitações) |

## 5. Regras respeitadas

Nenhuma conta externa real, nenhum envio real, nenhum banco de produção; runners fake injetados
(`setDefaultRunner`/`agentRunner`); bancos em `mkdtempSync` descartáveis. Nenhum teste de
segurança existente foi enfraquecido.

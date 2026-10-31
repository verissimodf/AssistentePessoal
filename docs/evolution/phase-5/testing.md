# Testes e Validação — Fase 5

Resultados reais executados em 2026-10-31 na branch
`evolution/phase-5-computer-intelligence-20261030`.

## 1. Suíte nova

| Arquivo | Testes | Cobertura (mapeada ao mandato §16) |
|---|---|---|
| `tests/computer.test.mjs` | 6 | **1-10**: sessão autorizada → captura (PNG persistido em `data/ci/`) → identificação (hash + conteúdo) → plano (2 ações com critério) → política → execução com D9 REAL (review+fingerprint para click; resolveHuman) → tick retoma → verificação pelo critério (`verification_json.verified`) → observações antes/depois vinculadas → procedimento tested→validated. **11-13**: reutilização de procedimento validado (sem permissões embutidas); mudança de interface → verificação diverge → interrupção segura (nunca repetição às cegas). **14**: ação de pagamento/compra BLOQUEADA por padrão (`ci_prohibited_action`). **15**: injeção visual — plano derivado de página hostil contém ação proibida → bloqueada; NENHUMA aprovação criada; audit sem o conteúdo hostil. **Extra**: indisponibilidade explícita (`ci_browser_disabled` — nunca simula); isolamento cross-owner (sessão/observação/procedimento → not_found) |

Total: **6 testes novos** backend (+ testes de UI via subagente).

## 2. Regressão completa

| Checagem | Comando | Resultado |
|---|---|---|
| Backend completo | `node --no-warnings --test tests/*.test.mjs` | **789/789 pass, 0 fail** (783 da Fase 4 + 6) |
| Frontend completo | `npx vitest run` | 127/127 + novos (confirmar no relatório final) |
| Avaliação agêntica | `npm run eval:agents` | 6/6 exit 0 |
| TypeScript | `npx tsc --noEmit` | exit 0 |
| Lint | `npx eslint .` | 0 problemas |
| Build de produção | `npm run build` | exit 0 |
| Config Docker | `docker compose config -q` | OK |
| Imagem + verificador de release | `docker build` + `scripts/verificar-imagem-release.sh` | **APROVADA** (container descartável; produção intocada) |
| Links da documentação | varredura de links relativos | 0 quebrados |

## 3. Categorias obrigatórias (mandato §15) × realizado

| Categoria | Onde |
|---|---|
| Observação visual (captura válida/inválida, elementos, stale) | `computer.test` (1-3, 11-13) |
| Execução (navigate/click via D9, pendências, bloqueio) | `computer.test` (1-10, 14) |
| Verificação e recuperação (critério, divergência, replan, interrupção, reconciliação via tick) | `computer.test` (1-10, 11-13) |
| Segurança (injeção visual, cross-owner, escopo, bloqueio proibido, audit limpo, D9) | `computer.test` (14, 15) + isolamento |
| Integração (Workforce via callTool, Workflow Studio via registry, Policy Engine, D9, memória procedural) | `computer.test` + wiring |
| Regressão Fases 0-4 | suíte completa 789 + frontend |

## 4. Notas de honestidade

- A demonstração usa um **worker fake** no transporte real (UDS + protocolo gerenciado) — o
  mesmo padrão dos testes de browser existentes; nenhuma conta/sistema real foi tocado.
- A imagem do worker (`Dockerfile.browser`) precisa de rebuild na próxima release para o novo
  protocolo `screenshotBase64` (ADR-CI-003); o profile permanece opt-in/desligado.

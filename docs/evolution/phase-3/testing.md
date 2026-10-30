# Testes e Validação — Fase 3

Resultados reais executados em 2026-10-30 na branch
`evolution/phase-3-workflow-behavior-studio-20261030`.

## 1. Suítes novas

| Arquivo | Testes | Cobertura |
|---|---|---|
| `tests/wf-migration.test.mjs` | 5 | v22 do zero (tabelas wf_*), backup íntegro, idempotência, upgrade v21→v22 preservando ownership (incl. kh_*), CHECKs (status de run/nó, efeito/escopo de política), FKs, versionamento único de definições e revisões |
| `tests/wf-engine.test.mjs` | 10 | validação de grafo (ciclo, start/end único, tipo inválido, aresta inválida); edição de rascunho vs. versões publicadas imutáveis; execução sequencial com nós+eventos; condition true/false com fail-closed (op inválida rejeitada na validação); nó approval com D9 real (waiting → aprovação retoma → completed; rejeição → failed `approval_rejected`; pendente nunca retoma sozinho); nó agent integrando o Workforce; nó knowledge_search com citação; cancelamento (waiting_dependency → cancelled; unknown → recusa, exige reconciliação); boot (running → unknown; waiting_dependency permanece); subworkflow com orçamento e falha tipada em definição inexistente |
| `tests/policies.test.mjs` | 5 | CRUD com validação (alvo inexistente/escopo/efeito/condições); decisões ALLOW/DENY/REQUIRE_APPROVAL (force D9 em ferramentas capazes; negação para tools sem caminho de aprovação); fail-closed com política corrompida → DENY auditado; precedência (deny vence allow com prioridade maior); isolamento cross-owner + invalidação de cache |
| `tests/wf-security.test.mjs` | 3 | **DEMONSTRAÇÃO DE ACEITE** (mandato §12): workflow real HTTP com knowledge_search → agent (Workforce) → approval D9 → revalidação → retomada → completed, com citação do acervo, vínculo agent_run_id, evidência persistida e eventos reconstruindo a história; execução NEGADA por política (nó tool falha `wf_policy_denied`, auditado, nada executa; workflow inteiro bloqueado por política); aprovação D9 não forjável (cross-owner 404) nem reutilizável cross-run |
| `src/test/workflow-ui.test.tsx` | 5 | helpers de badge (8 status de run + fallback, efeitos de política), `describeNode`, render do Workflow Studio com bridge mockada |

Total: **28 testes novos** backend + **5 novos** frontend.

## 2. Regressão completa

| Checagem | Comando | Resultado |
|---|---|---|
| Backend completo | `node --no-warnings --test tests/*.test.mjs` | **765/765 pass, 0 fail** (742 da Fase 2 + 23) |
| Frontend completo | `npx vitest run` | **121/121 pass** (116 + 5) |
| Avaliação agêntica | `npm run eval:agents` | 6/6 exit 0 |
| TypeScript | `npx tsc --noEmit` | exit 0 |
| Lint | `npx eslint .` | 0 problemas |
| Build de produção | `npm run build` | exit 0 |
| Config Docker | `docker compose config -q` | OK |
| Imagem + verificador de release | `docker build` + `scripts/verificar-imagem-release.sh` | **APROVADA** (container descartável; produção intocada) |
| Links da documentação | varredura de links relativos | 0 quebrados |

## 3. Ajustes em testes pré-existentes (não enfraquecimento)

- `tests/diagnostics.test.mjs`: contagem de ferramentas 22 → **25** (`notebook_search`, `notebook_transform`, `notebook_note` — Fase 2); nenhuma alteração na Fase 3 (nenhuma TOOL_DEF nova).
- `tests/kh-migration.test.mjs`: `targetVersion()` deixa de ser comparado a 21 hardcoded (≥ 21) — mesmo padrão já aplicado nas Fases 1-2.

## 4. Categorias obrigatórias (mandato §10) × realizado

| Categoria | Onde |
|---|---|
| Workflow Engine (validação, versionamento, ciclos, execução, checkpoint, idempotência, recuperação, unknown, reconciliação, cancelamento, timeout, falha parcial, orçamento, subworkflow, reexecução) | `wf-engine`, `wf-migration` |
| Aprovação D9 (válida, rejeição, duplicada, cross-owner, cross-workflow, bypass, retomada, revalidação) | `wf-engine`, `wf-security` |
| Policy Engine (ALLOW/DENY/REQUIRE_APPROVAL, fail-closed, precedência, inexistente/inválida, versão, cache, manipulação cliente/agente) | `policies` |
| Segurança integrada (escalada, confused deputy, cross-owner, replay, corrupção de estado, injeção via Hub) | `wf-security`, `policies` |
| Integração (Workforce, Hub, orçamento, API, UI, i18n) | `wf-engine`, `wf-security`, `workflow-ui` |
| Regressão (Fases 0-2, chat, durable jobs, dispatcher, D9, painel) | suíte completa 765 + 121 |

# Fase 5 — Computer Intelligence (J.A.R.V.I.S. Evolution)

**Status:** implementada · **Branch:** `evolution/phase-5-computer-intelligence-20261030` · **Base:** `66c2775` (Fase 4 + provedor searxng real)
**Escopo:** sessões de navegador isoladas com observação (screenshot persistido + texto/hash),
planos estruturados de ações pequenas, execução com **D9 por ação de escrita**, verificação
pelo critério do plano (aprovação ≠ prova), recuperação limitada com replan, memória procedural
(tested→validated→deprecated), ferramentas do Workforce, nós do Workflow Studio e Computer Studio
no painel. **Nenhum controle de desktop nativo** (ADR-EVO-008/ADR-CI-001).

## Documentos

| Documento | Conteúdo |
|---|---|
| [`architecture.md`](architecture.md) | Motor, componentes e fluxo |
| [`computer-engine.md`](computer-engine.md) | Engine, limites, invariantes |
| [`environments.md`](environments.md) | Ambientes (browser gerenciado / fixture) |
| [`visual-grounding.md`](visual-grounding.md) | Observação, identificação, stale |
| [`screen-capture.md`](screen-capture.md) | Captura, artefatos, retenção |
| [`action-planning.md`](action-planning.md) | Planos estruturados |
| [`action-execution.md`](action-execution.md) | Execução controlada (D9) |
| [`verification-recovery.md`](verification-recovery.md) | Verificação e recuperação |
| [`policy-d9-integration.md`](policy-d9-integration.md) | Policy Engine + D9 |
| [`procedural-memory.md`](procedural-memory.md) | Memória procedural |
| [`agent-integration.md`](agent-integration.md) | Ferramentas do Workforce |
| [`workflow-integration.md`](workflow-integration.md) | Nós do Workflow Studio |
| [`api-contracts.md`](api-contracts.md) | Rotas /api/ci/* |
| [`ui-operations.md`](ui-operations.md) | Computer Studio |
| [`security-threat-model.md`](security-threat-model.md) | Ameaças e controles |
| [`migration.md`](migration.md) | Schema v24 |
| [`operations.md`](operations.md) | Operação e troubleshooting |
| [`testing.md`](testing.md) | Suítes e resultados reais |
| [`decisions.md`](decisions.md) | ADR-CI-001..005 |
| [`traceability-matrix.md`](traceability-matrix.md) | Critérios → implementação → testes |
| [`limitations.md`](limitations.md) | Limitações reais e adiados |

## Demonstração de aceite (mandato §16) — resumo

App de teste determinístico via worker fake no MESMO transporte UDS do modo gerenciado:
sessão autorizada → captura (PNG persistido em `data/ci/<session>/`) → identificação → plano
(2 ações com verificação) → política → execução com D9 real (review + fingerprint para
click) → tick retoma → verificação pelo critério (aprovação ≠ prova) → procedimento
tested→validated → reutilização sem permissões → mudança de interface com interrupção segura →
ação de pagamento BLOQUEADA por padrão → instruções hostis exibidas na interface não alteram
nada. Evidência completa: `tests/computer.test.mjs` (6 testes).

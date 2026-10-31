# Matriz de Rastreabilidade — Fase 5

Critérios de aceite (mandato §18) → implementação → testes.

| Critério | Implementação | Testes |
|---|---|---|
| Gate da Fase 4 aprovado | commit `f8ff1e8` (Fase 4 completa) + `66c2775` (provedor searxng real) | preflight (§2) |
| Computer Intelligence Engine funcional | `server/computer.js` | `tests/computer.test.mjs` |
| Ambientes isolados e identificados | sessões `ci_sessions` (browser gerenciado/fixture), config/allowlist por sessão | `computer.test` (1-10, indisponibilidade) |
| Captura persistente e controlada | screenshotBase64 via UDS + `saveScreenshot` + retenção (máx 30, remoção no fechamento) | `computer.test` (1-10) |
| Interpretação visual funcional | extract (texto/título/URL) + hash de observação | `computer.test` (2-3) |
| Visual grounding com evidências | observações antes/depois vinculadas às ações | `computer.test` (9) |
| Planejamento estruturado | `planActions` (one-shot, ações pequenas + expected) | `computer.test` (4) |
| Execução autorizada | escritas via `callTool` (can() + política + D9); leituras diretas validadas | `computer.test` (5-8) |
| Verificação pós-ação | `verify(expected, postObs)` — critério explícito | `computer.test` (8) |
| Estados desconhecidos e reconciliação | `unknown` + `tickCiSessions` (por critério, nunca por decreto) | `computer.test` |
| Recuperação limitada | replan ≤ 2 + interrupção segura | `computer.test` (11-13) |
| Integração Policy Engine | `toolPolicyVerdict` no callTool (Fase 3) + bloqueio proibido | `computer.test` (14) |
| Integração D9 | `queueApproval`/`resolveApproval` reais (review+fingerprint) | `computer.test` (5-8, 15) |
| Proteção contra prompt injection visual | conteúdo da interface = dado; bloqueio mesmo com página hostil; audit sem conteúdo | `computer.test` (15) |
| Memória procedural integrada | `ci_procedures` (observed/tested/validated/deprecated) + reutilização sem permissões | `computer.test` (10-11) |
| Ferramentas do Agent Workforce | computer_observe/plan/execute/verify (TOOL_DEFS + escopos computer:*) | wiring + `diagnostics.test` (29 ferramentas) |
| Nós do Workflow Studio | `registerCiWorkflowNodes` (computer_session/observe/execute/verify) | wiring |
| Computer Studio funcional | `src/routes/computer.tsx` + bridge + i18n | `computer-ui.test` |
| Migrações validadas | v24 limpo + upgrade + idempotência | suíte de migrações |
| Testes de segurança aprovados | bloqueio/injeção/isolamento/D9 | `computer.test` |
| Demonstração local de aceite concluída | §16 (1-15) | `computer.test` |
| Regressão Fases 0-4 | backend 789/789 · frontend 127+ · eval 6/6 | [`testing.md`](testing.md) |
| Documentação completa | 22 documentos + ADR-CI-001..005 | links verificados |
| Commit local revisado | diff revisado, sem segredos | relatório executivo |

Não concluído (documentado, não reduzido): [`limitations.md`](limitations.md) — sem DOM/a11y
estruturado no worker v1, sem OCR/vision model, aprovação por ação (sem batch), sem desktop
nativo, nós CI dedicados executam via registry mas sem transporte de sessão entre nós.

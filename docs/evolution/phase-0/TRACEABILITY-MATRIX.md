# Matriz de Rastreabilidade — Fase 0

Rastreabilidade: requisito do mandato → documento(s) → ADR → controles de segurança →
validação.

## Workstreams → documentos

| Workstream (mandato §5) | Documento | ADRs relacionados | Validação |
|---|---|---|---|
| A — Auditoria de capacidades | `01-EXISTING-CAPABILITY-INVENTORY.md` | — | Referências arquivo:linha verificadas por 3 auditorias independentes do código |
| B — Arquitetura as-is | `02-CURRENT-ARCHITECTURE.md` | ADR-EVO-001 | Diagramas conferem com `docs/ARQUITETURA.md` (1.10.0) e código |
| C — Arquitetura-alvo | `03-TARGET-ARCHITECTURE.md` | 001, 010 | Matriz de tecnologia §4; critério de decomposição §5 |
| D — Contratos de workforce | `04-AGENT-AND-WORKFLOW-CONTRACTS.md` §1-6 | 002, 003 | Contratos revisados contra controles existentes |
| E — Contratos de workflow | `04` §7-8 | 004 | Regras de idempotência/recovery derivadas de `jobs.js:158` |
| F — Conhecimento e memória | `05-KNOWLEDGE-AND-MEMORY-ARCHITECTURE.md` | 005, 006 | Contrato comum compatível com v17 e D_REC |
| G — Modelo de ameaças | `06-SECURITY-THREAT-MODEL.md` | 002-004, 007-009 | 20 cenários TH-01..20 + 14 invariantes |
| H — Governança/Behavior Studio | `03` §3.8, `adr/ADR-EVO-007` | 007 | Separação guidance vs enforcement explícita |
| I — Computer intelligence | `03` §3.7, `adr/ADR-EVO-008` | 008 | Fronteira desenhada; nada implementado |
| J — Observabilidade e avaliação | `03` §3.10, `adr/ADR-EVO-009` | 009 | Métricas com numerador/denominador/fonte; sem baselines inventados |
| K — Backlog e dependências | `08-IMPLEMENTATION-ROADMAP.md` | todos | Pré-requisitos da Fase 1 explícitos |

## Ameaças → controles → backlog

| Ameaça | Controle existente (referência) | Controle requerido | Item de backlog |
|---|---|---|---|
| TH-01/02 (injeção documento/web) | untrusted `tools.js:46,249`; anti-injeção `llm.js:335`; eval:agents | guarda generalizada; envelope estruturado | F4.3, Fase 2/4 |
| TH-03 (skill maliciosa) | confinamento `skills.js:197`; checksum no provisionamento | checksum em runtime | **F1.6** |
| TH-04 (MCP comprometido) | escopos no token `mcp.js:1-8`; callTool revalida | manter; sem approvals via MCP | — |
| TH-05 (escalação de agente) | `can()` `auth.js:570`; principals tipados | propagação de principal; mutação só via sessão | **F1.1, F1.4** |
| TH-06 (acesso inter-agente) | ownership; 404 uniforme | tipos `agent_run` em ownership; correlation_id | **F1.1** |
| TH-07 (vazamento entre admins) | JOIN ownership; testes de isolamento | regra "recurso novo → teste de isolamento" | todas as fases |
| TH-08 (segredo no contexto) | settings cifrados; audit allowlist | teste de ausência de segredos no payload | F3.5 |
| TH-09 (abuso de egress) | worker sem rede; grants ≤65 s | monitorar grants | F3.5 |
| TH-10 (SSRF) | `assertSafeUrl`/`assertPublicHost` `browser.js:92,118` | mesma política p/ motor de busca | **F4.1** |
| TH-11/12 (replay/duplicação) | v15/v16 idempotência; `jobs.js:158` | idempotência por step | **F1.3, F3.1** |
| TH-13 (conclusão forjada) | `verifiedBy` nomeado `tools.js:1516` | `completed` exige evidência | **F1.3, F3.1** |
| TH-14 (autorização forjada) | D9 + claim condicional `tools.js:1624` | envelope sem campo de autorização | **F1.4** |
| TH-15 (memória alheia) | `visibleMemorySql`; owner na criação | herdar nos domínios novos; namespace Gigabrain | F2.3, F2.5 |
| TH-16 (multimodal malicioso) | assinatura/limites `stt.js:31` | transcrição untrusted | F6 |
| TH-17 (GUI errada) | capacidade inexistente (correto) | sessão isolada + pós-condição visual | **F5.1** |
| TH-18 (exaustão) | deadline 5 min; concorrência 2/admin | orçamento hierárquico | **F1.2** |
| TH-19 (provider hostil) | erros tipados; fail-closed | provider test antes de habilitar | existente |
| TH-20 (adulterar evidência) | triggers v9; audit imutável | `verifiedBy` em todo fluxo novo | **F1.3** |

## Invariantes de segurança → onde estão garantidas

| Invariante (`06` §3) | Garantia atual | Design futuro |
|---|---|---|
| I1-I3 (autorização no backend) | `auth.js:570`, `index.js:1270`, `tools.js:1026` | `adr/ADR-EVO-002` |
| I4 (entrada não confiável) | `tools.js:46,249`; `llm.js:335` | F4.3 |
| I5-I6 (modelo não autoriza; auto-relato ≠ evidência) | D9 + `verifiedBy` | `adr/ADR-EVO-009` |
| I7 (técnico ≠ negócio) | `db.js:302-308` | `04` §7 |
| I8 (efeito sob D9) | `tools.js:919,1565` | `04` §7 |
| I9 (idempotência em retries) | v15/v16; `jobs.js:158` | `adr/ADR-EVO-004` |
| I10 (segredos fora de logs) | `AUDIT_FIELDS` `db.js:148` | F3.5 (teste) |
| I11 (ownership) | `ownership.js` | tipos novos F1.1 |
| I12 (unknown até reconciliar) | `interrupted` em `db.js:374` | `adr/ADR-EVO-003` |
| I13 (negado ≠ executado) | estados fechados | `04` §2 |
| I14 (GUI isolada) | capacidade inexistente | `adr/ADR-EVO-008` |

## Verificação estrutural

- Documentos exigidos: 12 + 10 ADRs — todos presentes (ver `09-PHASE-0-VALIDATION-REPORT.md`).
- Links internos: validados por varredura de links relativos (ver relatório §validação estrutural).
- Indexação: `docs/INDICE.md` (seção "Evolução") e `README.md` (link conciso) atualizados.

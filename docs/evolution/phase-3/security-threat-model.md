# Security & Threat Model — Workflow & Behavior Studio (Fase 3)

Ameaças específicas do motor sobre os modelos anteriores
(`phase-0/06-SECURITY-THREAT-MODEL.md` §3, `phase-2/security-threat-model.md`). Controles com
referência ao código implementado.

## Ameaças e controles

| # | Ameaça | Controles implementados | Residual |
|---|--------|-------------------------|----------|
| WF-1 | **Nó agent como escalação de privilégio** | O especialista executa com escopos = definição do agente ∩ escopos EFETIVOS do workflow (derivados das `allowed_tools` declaradas, `workflow.js` `workflowScopes`); `callTool` revalida na execução; orçamento da Fase 1 | Baixo — testado (nó agent integra Workforce) |
| WF-2 | **Aprovação forjada pelo próprio agente** | Aprovações são linhas em `approvals` criadas pelo backend (`createWorkflowApproval`); resolução exige sessão verificada + ownership (`/api/approvals/:id` → `resolveApproval`); saída de modelo não aprova | Baixo — testado (cross-owner 404) |
| WF-3 | **Reutilização de aprovação cross-run** | Cada execução de nó cria a SUA aprovação (`approval_id` único por nó); correlação por run; claim único `pending→…` (`tools.js:1742`) | Baixo — testado |
| WF-4 | **TOCTOU (aprovação muda contexto)** | Revalidação no momento da execução: `resolveApproval` revalida gate/fingerprint; `callTool` revalida escopo+política na execução real | Baixo |
| WF-5 | **Bypass da aprovação (nó seguinte ignora pendência)** | Run fica `waiting_approval` e SÓ retoma via tick quando a aprovação resolvida é `done`; rejeição → `failed` com `approval_rejected`; `tickWfRuns` não retoma pendentes | Baixo — testado |
| WF-6 | **Política manipulada por agente/cliente** | Políticas são administradas SOMENTE por sessão verificada (rotas `session`); ownership (`wf_policy`); avaliação determinística sem eval; cache invalidado apenas por mutação autenticada | Baixo — testado |
| WF-7 | **Política malformada vira allow** | Fail-closed: condição inválida (mesmo corrompida direto no banco) → DENY auditado (`policy.fail_closed`) — validação roda antes do skip de listas vazias | Baixo — testado |
| WF-8 | **Confused deputy (workflow de outro owner)** | Todas as operações por `owns()`; 404 uniforme; workflow de BIA não afeta runs de ana | Baixo |
| WF-9 | **Replay de execução** | `idempotency_key` UNIQUE parcial; retomada pula nós completados (checkpoint por nó); `unknown` nunca re-executa sem reconciliação | Baixo — testado |
| WF-10 | **Injeção via Knowledge Hub em nós do workflow** | Resultados do Hub entram como DADO NÃO CONFIÁVEL nas saídas de nó (mesma marcação da Fase 2); nós tool passam por política+D9 | Baixo-médio (mesmo residual KH-1) |
| WF-11 | **Exaustão por fan-out/subworkflows** | `MAX_PARALLEL=2`, `max_nodes=50`, `max_agent_runs=10`, `max_depth=3` (subworkflow), timeout global 10 min; excedentes falham com código tipado | Baixo — testado |
| WF-12 | **Corrupção de estado do run** | Transições atômicas (`UPDATE … WHERE status = ?`); estados terminais protegidos; eventos append-only | Baixo |
| WF-13 | **Interpolação maliciosa (`$node.…`)** | Resolver percorre saídas de nós JÁ concluídos do próprio run; sem eval; valores não-objeto retornam como estão | Baixo |

## Invariantes específicas (Fase 3)

1. Aprovação é fronteira: solicitação ≠ aprovação ≠ autorização efetiva ≠ execução concluída
   (estados distintos no painel e no banco).
2. `REQUIRE_APPROVAL` nunca autoriza diretamente: força o caminho D9 em ferramentas capazes e
   NEGA ferramentas sem caminho de aprovação (ADR-WF-002).
3. DENY prevalece sobre qualquer efeito (avaliado primeiro, por precedência).
4. O motor não cria caminho de autorização alternativo: toda ferramenta passa por `callTool`.
5. Workflows não têm escopos próprios além do que o operador declarou em `allowed_tools`.

## Riscos aceitos

- **Aprovação via nó resolve ações reais** (ex.: run_command com allowlist) — o mesmo risco do
  D9 existente, com as mesmas revalidações.
- **Fail-closed de política corrompida no banco** depende de correção operacional
  (`invalidatePolicyCache` após correção manual) — fora do escopo de atacante remoto.

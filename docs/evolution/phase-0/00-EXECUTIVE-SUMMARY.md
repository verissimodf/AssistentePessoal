# 00 — Sumário Executivo

**Data:** 2026-10-30 · **Fase:** 0 — Arquitetura e Segurança · **Veredito:** ver §"Veredito".

## Recomendação de negócio

Evoluir o AssistentePessoal de "um bot agêntico com fila durável" para uma **força de trabalho de
agentes especializados com governança**, sem substituir o núcleo que já está em produção. As
fundação técnicas exigidas pela evolução já existem e estão testadas: identidade de principal
inviável de forjar (`server/auth.js`), revalidação de escopo no momento da execução
(`server/tools.js:1026-1040`), ownership imutável (`server/ownership.js`), fila durável idempotente
(`server/jobs.js`, schema 19), evidência de execução com verificador nomeado (`server/db.js:309-342`)
e telemetria sem conteúdo. A evolução é **aditiva e modular** — não requer novo banco, novo
runtime nem reescrita.

## Principais conclusões

1. **Os controles de segurança críticos já existem e são o ponto forte do sistema.** Autorização
   deny-by-default, ownership por linha, aprovação humana D9 com impressão digital revalidada no
   momento da execução, auditoria apenas de metadados. A evolução deve **reutilizar**, nunca
   contornar, esses controles (invariantes em `06-SECURITY-THREAT-MODEL.md`).
2. **A lacuna central não é segurança — é orquestração.** Hoje existe 1 bot → 1 `runAgent` →
   loop de ferramentas com teto plano de orçamento (`server/bots.js:42-141`, `server/llm.js:294-521`).
   Não há runs aninhados, orçamento hierárquico, comunicação estruturada entre especialistas,
   engine de workflows (zero ocorrências de "workflow" em `server/`), nem retomada de execução
   parcial (`needs_reconciliation` é terminal e manual, `server/jobs.js:157-171`).
3. **Gaps de qualidade específicos** — descobertos na auditoria, não na documentação: roteamento
   por perfil de tarefa é cosmético (`classifyTaskIntent` não influencia a escolha de provider,
   `server/llm.js:629-669`); recall de memória e busca RAG fazem cosine O(N) em JS sem índice
   vetorial (`server/tools.js:884-901`, `server/documents.js:515-525`); `load_skill` não verifica
   checksum em runtime (só no provisionamento, `server/skills.js:277-370`); Gigabrain é memória
   transversal fora do modelo de ownership e fora da retenção.
4. **Dos cinco projetos de referência, só padrões conceituais se aplicam.** Todos são Python;
   o código não é reaproveitável e, no caso do AutoGPT platform, nem licenciável para este uso
   (PolyForm Shield). Os padrões de maior valor são: modelo de domínio notebook→source→insight
   (Open Notebook, MIT), guidelines condição→ação com matching por turno (Parlant, Apache-2.0),
   grafos de execução versionados com controles de gasto (AutoGPT) e separação
   planejador/verificação visual (Agent S, Apache-2.0).

## Veredito arquitetural

**Evolução modular sobre a base atual — PROSSEGUIR com a Fase 1 conforme `08-IMPLEMENTATION-ROADMAP.md`.**

- Manter Node.js 22 + SQLite (WAL, schema 19) como única infraestrutura de estado.
- Introduzir a Agent Workforce como **extensão** de `server/bots.js`/`server/tools.js` (mesmos
  principals, mesmo `callTool`, mesmo ledger de evidência), não como subsistema paralelo.
- Workflows e memória de três domínios como **tabelas SQLite versionadas** (migrações v20+),
  não como serviços externos.
- Search híbrido via **FTS5 + extensão vetorial embutida no SQLite**, não novo banco — decisão
  técnica registrada em `adr/ADR-EVO-006`, com migração incremental opcional.

## Riscos principais

| Risco | Severidade | Mitigação no design |
|---|---|---|
| Runs órfãos de execução interrompida (sem GC/timeout) se a Workforce reutilizar o modelo atual de runs | Alta | `AgentRun` com estados terminais obrigatórios + reconciliação explícita (`04`, `adr/ADR-EVO-003`) |
| Workflow interrompido repetir efeito externo | Alta | Herdar o princípio de `jobs.js:158` — efeito já ocorrido nunca re-executa; idempotência por step (`adr/ADR-EVO-004`) |
| Injeção de instruções via skill usada como configuração de agente | Média | Procedência e checksum em runtime como pré-requisito (`06`, TH-03) |
| Delegação como escalação de privilégio | Alta | Principal propagado, sub-orçamento nunca supera o pai, `callTool` continua a única porta de ferramentas (`adr/ADR-EVO-002`) |
| Memória inferida pelo modelo virar "fato" permanente | Média | Proveniência + distinção fato/hipótese + ingestão opt-in (`05`, `adr/ADR-EVO-005`) |
| Lint com dívida pré-existente (`no-explicit-any`, Prettier) bloquear CI das fases novas | Baixa | Redução em lotes pequenos registrada no roadmap; não é bloqueio da Fase 0 |

## Prontidão da Fase 1 (Agent Workforce)

**Pronta após 3 pré-requisitos técnicos** (todos internos, sem decisão de negócio):
1. Reconciliação de runs órfãos (estado `unknown` → resolução explícita) — extensão de `jobs.js`.
2. Orçamento hierárquico de execução no `runAgent` — extensão de `llm.js`/`bots.js`.
3. Contrato `AgentRun`/`ToolInvocation` implementado conforme `04` com testes de isolamento.

Itens que exigem decisão do dono do repositório antes da Fase 1: nenhuma. As decisões de produto
(Política de governança em produção, GUI automation) ficam para as Fases 3 e 5.

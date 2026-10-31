# 08 — Roadmap de Implementação (Fases 1–6)

Backlog orientado a implementação, derivado de `01` (lacunas), `04`-`06` (contratos e controles) e
`07` (padrões adotados). Cada item tem critério de aceite verificável. Prioridades: P0 = crítico,
P1 = alto, P2 = desejável. Nenhuma fase começa sem os pré-requisitos da anterior fechados.

## Fase 0 (esta) — Arquitetura e Segurança
Entregues: inventário (`01`), as-is (`02`), alvo (`03`), contratos (`04`), memória (`05`),
ameaças (`06`), referências (`07`), ADRs. Nenhuma mudança de produto.

## Fase 1 — Agent Workforce

| Item | Escopo técnico | Depende de | Segurança | Aceite | Prio | Complexidade |
|---|---|---|---|---|---|---|
| F1.1 Migrações v20: `agent_definitions`, `agent_runs` | Tabelas conforme `04` §1-2; tipos novos em `ownership.TYPES` + `assignNew` na criação | — | Ownership na criação (TH-06/07) | Migração com backup verificado; teste de isolamento; run sem owner invisível | P0 | Média |
| F1.2 Orçamento hierárquico | Extender `runAgent`/`bots.js`: budget por run, soma dos filhos ≤ pai; profundidade ≤ 3 | F1.1 | TH-18 | Teste: filho excedente é negado e auditado | P0 | Média |
| F1.3 Executor de AgentRun | Substituir `activeBotRuns` in-memory por execução baseada em `agent_runs` com estados `04` §2; runs órfãos → `unknown` no boot | F1.1 | TH-12, invariante I12 | Teste: crash simulado → `unknown`, nunca `completed`; reconciliação manual funciona | P0 | Alta |
| F1.4 Delegação pai→filho | Criação de runs filhos com sub-orçamento e envelope `04` §5 | F1.2, F1.3 | TH-05/06/14 | Teste: filho não herda escopos além do granted; mensagem não autoriza | P0 | Alta |
| F1.5 Painel: força de trabalho | CRUD de AgentDefinitions + visão de runs/árvore de correlação | F1.1 | Escopos de rota novos (`agents:write`) | Testes de rota; 404 entre admins | P1 | Média |
| F1.6 Checksum de skill em runtime | `load_skill` verifica SHA256 antes de carregar | — | TH-03 | Teste: skill alterada pós-provisionamento é recusada | P1 | Baixa |
| F1.7 Schemas de tool tipados | JSON Schema real nas TOOL_DEFS (fecha gap `llm.js:73-87`) | — | Reduz erro de entrada | Testes de validação de input | P2 | Média |

**Critério de pronto da Fase 1:** especialista criado no painel executa objetivo com
sub-delegação limitada, com evidência verificada por passo de efeito externo e zero acesso
cross-admin nos testes.

## Fase 2 — Personal Knowledge Hub

| Item | Escopo | Depende de | Aceite | Prio | Complex. |
|---|---|---|---|---|---|
| F2.1 Índice híbrido no SQLite | FTS5 + extensão vetorial; migração de embeddings para índice; eliminar cosine O(N) | — | Busca retorna os mesmos resultados atuais + performance medida em corpus sintético | P0 | Média |
| F2.2 Modelo notebook/source/note/insight | Tabelas + rotas + painel (padrão `07` §3) | F2.1 | Citações com snapshot em toda resposta do hub | P0 | Média |
| F2.3 Memória em três domínios | Episódica (view sobre conversas/runs), semântica (`entity_edges` + kind fact/hypothesis/inference), procedural (receitas de workflows verificados) | F2.2, Fase 1 | Testes de visibilidade; hypothesis nunca entra no contexto por padrão | P0 | Alta |
| F2.4 Transformações parametrizadas | Prompts reutilizáveis com revisão humana antes de persistir | F2.2 | Prévia editável + confirmação (padrão roadmap) | P1 | Baixa |
| F2.5 Namespace Gigabrain | Leitura segregada por admin; decisão de produto sobre compartilhamento | F2.3 | TH-15 | Teste: admin não lê namespace alheio | P2 | Baixa |

## Fase 3 — Workflow e Behavior Studio

| Item | Escopo | Depende de | Aceite | Prio | Complex. |
|---|---|---|---|---|---|
| F3.1 Motor de workflows duráveis | `workflow_definitions/runs/step_states` (v21+); checkpoints, cancelamento, retomada por `durable_jobs` | Fase 1 | Crash no meio de step com efeito → `unknown` + reconciliação; nunca replay cego | P0 | Alta |
| F3.2 Nós de aprovação em workflow | Steps `approval` mapeiam para D9 existente | F3.1 | Workflow fica `awaiting_approval`; negação cancela downstream | P0 | Média |
| F3.3 Policy engine no backend | Guidelines condição→ação versionadas, relações exclude/dependency, avaliadas por turno antes da montagem do contexto (padrão `07` §4) | Fase 1 | Política é enforcement no backend; teste de bypass de prompt | P1 | Alta |
| F3.4 Canned responses STRICT | Templates pré-aprovados para ações críticas | F3.3 | Resposta crítica sai de template, nunca de geração livre | P1 | Baixa |
| F3.5 Telemetria persistida com retenção | Persistir `/api/router/telemetry` com limite/expurgo configurável; sem PII | F3.1 | Teste de ausência de conteúdo/PII (roadmap P1) | P1 | Média |
| F3.6 Builder visual (opcional) | Editor de workflows no painel | F3.1 | Validação de DAG antes de salvar | P2 | Alta |

## Fase 4 — Deep Research e Learning

| Item | Escopo | Depende de | Aceite | Prio | Complex. |
|---|---|---|---|---|---|
| F4.1 Motor de busca web estruturado | Provider dedicado + fallback (substitui scraping DDG único `tools.js:251`); SSRF/`urlpolicy` obrigatórios | F2.1 | Testes de política de URL; falha sinalizada estruturadamente | P0 | Média |
| F4.2 Pipeline de pesquisa retomável | Pesquisa multi-etapa com checkpoints, relatório com citações e sinalização de parcialidade (padrão `07` §1) | F3.1, F2.3 | Retomada após crash sem repetir coleta concluída | P0 | Alta |
| F4.3 Corpus de avaliação de injeção estendido | Cenários de TH-01/02 em `eval:agents` | F4.1 | CI cobre injeção web/documento/memória | P0 | Média |
| F4.4 Learning journal | Sessões de estudo com resumo e revisão (padrão DeepTutor), opt-in | F2.3 | Nada persiste sem confirmação humana | P2 | Média |

## Fase 5 — Computer Intelligence

| Item | Escopo | Depende de | Aceite | Prio | Complex. |
|---|---|---|---|---|---|
| F5.1 Fronteira ComputerUseExecutor | Sessão GUI isolada (padrão worker/UDS/grants de `browser.js`); planner/executor separados; pós-condição visual com evidência | Fase 3 | Perfil Compose isolado desligado por padrão; cada ação com aprovação + screenshot de evidência; bypass de allowlist bloqueado em smoke | P1 | Muito alta |
| F5.2 Memória procedural GUI | Receitas de fluxos GUI verificados | F5.1, F2.3 | Só de execução `verified` | P2 | Alta |

**Decisão de produto exigida antes da Fase 5:** habilitar input sintético no host do operador
(`adr/ADR-EVO-008` — PROPOSED). Default seguro: permanecer desligado.

## Fase 6 — Multimodal Experience

| Item | Escopo | Depende de | Aceite | Prio | Complex. |
|---|---|---|---|---|---|
| F6.1 Streaming de voz validado | STT/TTS contínuos com indicador visual de captura | Fase 3 | Consentimento + indicador; áudio nunca em disco | P1 | Alta |
| F6.2 Conteúdo visual no Knowledge Hub | Imagens/PDFs visuais como fontes com citação de página/região | Fase 2 | Citação por página/região verificável | P2 | Alta |

## Pré-requisitos e correções pré-Fase 1

1. **Reconciliação de runs órfãos** (F1.3) — sem isso, a Workforce herda órfãos eternos.
2. **Orçamento hierárquico** (F1.2) — sem isso, delegação = exaustão de recursos (TH-18).
3. **Registro de ownership na criação de todo recurso novo** — regra de processo para todas as
   fases (já é regra do CONTRIBUTING; reforçar em code review).
4. **Dívida de lint** (pré-existente: violações `no-explicit-any`/Prettier do baseline) — reduzir
   em lotes pequenos; não bloqueia Fase 0, mas deve ser reduzida antes de F3.1 (motor de
   workflows) para não misturar reformatação com mudança funcional (regra do roadmap).

## Sequência sugerida

F1.1 → F1.2 → F1.6 → F1.3 → F1.4 → F1.5 → (F2.1 ∥ F1.7) → F2.2 → F2.3 → F3.1 → F3.2 → F3.3 →
F4.1 → F4.2 → F5.1 → F6.

# Roadmap de Evolução do J.A.R.V.I.S. — Índice Central (Fases 0–9)

J.A.R.V.I.S. é um assistente **local** (Node 22, `node:sqlite` sem dependências
nativas, painel React/Vite/TanStack, Docker) evoluído em 9 fases sobre uma base
pré-existente já sólida: auth SCOPES deny-by-default, ownership imutável, audit
central, choke point único de autenticação/autorização em `server/index.js` e
migrações versionadas com backup verificado.

## Estado final do roadmap

> **Fase 9 (encerramento): PASS WITH LIMITATIONS** — plataforma tecnicamente
> consistente (848/848 backend, 195/195 frontend, 6/6 eval, demo de aceite 37/37);
> prontidão de produção condicionada a credenciais OAuth reais, STT em execução e
> monitoramento/backup do ambiente de destino. Parecer completo:
> [phase-9/final-opinion.md](phase-9/final-opinion.md).

> ⚠️ **Aviso importante**: os branches das fases 0–9 estão **locais e NÃO merged/pushed**.
> Unificar e publicar é **decisão do operador**.

## Fases

### Fase 0 — Fundamentos de Arquitetura e Segurança

- **Objetivo**: estabelecer a arquitetura-alvo e os invariantes de segurança de todas as fases seguintes.
- **Componentes**: ADRs EVO-001..010, invariants I1–I14, inventário de capacidade e arquitetura atual/alvo.
- **Branch/commit**: commit `37fe628` (architecture/security).
- **Docs**: [phase-0/README.md](phase-0/README.md).
- **Veredicto**: concluída — fundamentos adotados e preservados por todas as fases.

### Fase 1 — Agent Workforce

- **Objetivo**: delegação de trabalho a agentes com orçamento de execução.
- **Componentes**: `server/workforce.js` (migração v20), delegação, orçamento.
- **Branch/commit**: commit `de02d67`.
- **Docs**: [phase-1/README.md](phase-1/README.md).
- **Veredicto**: concluída — workforce integrado ao choke point de autorização.

### Fase 2 — Knowledge Hub

- **Objetivo**: base de conhecimento local com busca híbrida e citações confiáveis.
- **Componentes**: `server/knowledge.js` (v21, FTS5 + cosine), `kh_jobs`, citações autoritativas.
- **Branch/commit**: commit `5a40f47`.
- **Docs**: [phase-2/README.md](phase-2/README.md).
- **Veredicto**: concluída — citação autoritativa como invariante.

### Fase 3 — Workflow & Behavior Studio

- **Objetivo**: automação de fluxos in-process com aprovação humana obrigatória quando sensível.
- **Componentes**: `server/workflow.js` (v22), motor in-process, `REQUIRE_APPROVAL`, políticas.
- **Branch/commit**: commit `5a05ca5`.
- **Docs**: [phase-3/README.md](phase-3/README.md).
- **Veredicto**: concluída — D9/Policy Engine como porteiros de execução.

### Fase 4 — Deep Research & Learning

- **Objetivo**: pesquisa profunda com fontes reais e aprendizado contínuo.
- **Componentes**: `server/research.js`/`learning.js` (v23), searxng real via `CNC_APP_PROD_01`, citação verbatim validada.
- **Branch/commit**: commits `f8ff1e8` + `66c2775`.
- **Docs**: [phase-4/README.md](phase-4/README.md).
- **Veredicto**: concluída — busca real com indisponibilidade explícita.

### Fase 5 — Computer Intelligence

- **Objetivo**: operar um navegador isolado com controle nativo D9 e memória procedural.
- **Componentes**: `server/computer.js` + `browser-*` (v24), browser UDS isolado, egress policy.
- **Branch/commit**: commit `832450f`.
- **Docs**: [phase-5/README.md](phase-5/README.md).
- **Veredicto**: concluída — isolamento por Unix socket, D9 nativo.

### Fase 6 — Multimodal Experience

- **Objetivo**: interação por voz com sessões/turnos e honestidade de estado.
- **Componentes**: `server/multimodal.js` (v25), STT whisper.cpp, TTS xtts **real** (347 KB WAV; 13,9 s aquecido), avatar honesto, sem áudio persistido.
- **Branch/commit**: commit `acddcc4`.
- **Docs**: [phase-6/README.md](phase-6/README.md).
- **Veredicto**: concluída — imagem verificada (APROVADA); STT real pendente de infraestrutura no ambiente.

### Fase 7 — Proactive Intelligence

- **Objetivo**: recomendar e agir por regras versionadas — sempre com aceite humano antes de executar.
- **Componentes**: `server/proactive.js` (v26), regras com justificativa/evidências, níveis 0–3, notificações internas.
- **Branch/commit**: commit `4c244cc`.
- **Docs**: [phase-7/README.md](phase-7/README.md).
- **Veredicto**: concluída — nunca auto-executar; execução só via Workflow Engine.

### Fase 8 — Integration Fabric & Temporal Intelligence

- **Objetivo**: receber eventos externos autenticados e sincronizar calendário com timezone correta.
- **Componentes**: `server/integrations.js` + `calendar.js` (v27), webhook HMAC, contrato canônico, calendar provider abstrato, timezone IANA/DST.
- **Branch/commit**: commit `2e92d09`.
- **Docs**: [phase-8/README.md](phase-8/README.md).
- **Veredicto**: concluída — demo 20/20; imagem verificada (APROVADA); Google Calendar pendente de credencial.

### Fase 9 — Consolidação Final e Prontidão *(esta)*

- **Objetivo**: auditar integralmente a plataforma, corrigir o que é estrutural, documentar o resto e emitir o parecer de encerramento.
- **Componentes**: auditoria arquitetural (duplicações, ciclo `bots.js`↔`jobs.js`, `SttError`, bug das regras irmãs da F8, migração v28 aditiva com 12 índices, dead code removido, 24 documentos).
- **Branch/commit**: `evolution/phase-9-final-consolidation-20261031`; commit previsto `feat(evolution): finalize platform consolidation and readiness`.
- **Docs**: [phase-9/README.md](phase-9/README.md) (+ 23 documentos).
- **Veredicto**: **PASS WITH LIMITATIONS** — ver [phase-9/final-opinion.md](phase-9/final-opinion.md) e [phase-9/production-readiness.md](phase-9/production-readiness.md).

## Números finais da plataforma

| Métrica | Valor |
|---|---|
| Backend | 848/848 (~93 arquivos de teste) |
| Frontend | 195/195 |
| Eval de agentes | 6/6 |
| tsc / eslint | 0 / 0 |
| Build / Compose | OK / OK |
| Demo final de aceite | 37/37 (`scripts/demo-final-acceptance.mjs`) |
| Migrações | v1–v28 (v28 aditiva: 12 índices) |
| Rotas públicas | 6 (asseridas em `tests/http-auth.test.mjs`) |
| Rotas com `access` declarado | 224 |

## Documentos de encerramento (Fase 9)

Parecer final, limitações classificadas, prontidão e contingência:
[final-opinion.md](phase-9/final-opinion.md) ·
[limitations.md](phase-9/limitations.md) ·
[production-readiness.md](phase-9/production-readiness.md) ·
[contingency.md](phase-9/contingency.md) ·
[runbook.md](phase-9/runbook.md).

# Inventário de Módulos — Fase 9

Inventário dos módulos do backend (`server/`) e sua origem no roadmap. "Base" indica
código pré-existente às fases de evolução (mantido e reforçado por elas).

## Backend

| Módulo | Arquivo | Fase | Responsabilidade |
|---|---|---|---|
| Servidor / choke point | `server/index.js` | Base | HTTP único ponto de authn/authz; toda rota declara `access` |
| Autenticação | `server/auth.js` | Base | Sessões, SCOPES, deny-by-default, `isVerifiedAdmin()` (pura, clock injetável) |
| Ownership | `server/ownership.js` | Base | Tabela `ownership` imutável; filtro por `owner_admin_id` em tudo |
| Migrações | `server/migrations.js` | Base (v1–v19) + F1–F9 (v20–v28) | Migrações versionadas com backup verificado e transação única |
| Banco | `server/db.js` | Base | `node:sqlite`, sem deps nativas |
| Política de host | `server/hostpolicy.js` | Base | Segurança de comandos de host (unit-testada em `tests/hostpolicy.test.mjs`) |
| Segredos | `server/secret-crypto.js` | Base | AES-256-GCM |
| Settings | `server/settings.js` | Base | `admin_settings` (pessoal) vs `global_settings` (global, só admin verificado) |
| Utilitários | `server/util.js` | F9 | `parseJson`, `clean` consolidados (antes 10 e 9 cópias) |
| Workforce | `server/workforce.js` | F1 | Delegação a agentes, orçamento; migração v20 |
| Knowledge Hub | `server/knowledge.js` | F2 | FTS5 + cosine, `kh_jobs`, citações autoritativas; v21 |
| KH fetch/one-shot | `server/kh-fetch.js`, `server/kh-oneshot.js` | F2 | Ingestão e execução one-shot do KH |
| Workflow Engine | `server/workflow.js` | F3 | Motor in-process, `REQUIRE_APPROVAL`, políticas; v22 |
| Policy Engine | `server/policies.js` | Base/F3 | Políticas de execução |
| Research | `server/research.js` | F4 | Deep research (searxng real via `CNC_APP_PROD_01`); v23 |
| Learning | `server/learning.js` | F4 | Aprendizado contínuo; v23 |
| Busca | `server/research-search.js` | F4 | Camada de busca do research |
| Computer Intelligence | `server/computer.js` | F5 | Browser UDS isolado, D9 nativo, memória procedural; v24 |
| Browser | `server/browser.js`, `server/browser-*.js` | F5 | Worker UDS, egress policy, hosts, rede |
| Multimodal | `server/multimodal.js` | F6 | Sessões/turnos/eventos; v25 |
| STT | `server/stt.js` | F6 (+F9: `SttError`) | whisper.cpp; indisponibilidade explícita |
| TTS/Voz | `server/voice.js` | F6 | xtts **real** (347 KB WAV medido) |
| Proativo | `server/proactive.js` | F7 (+F9: irmãs) | Regras versionadas, oportunidades, níveis 0–3, notificações; v26 |
| Integrações | `server/integrations.js` | F8 (+F9: índices/queries) | Webhook HMAC, contrato canônico; v27 |
| Calendário | `server/calendar.js` | F8 | Provider abstrato (`fixture`/`google`), timezone IANA/DST; v27 |
| Bots | `server/bots.js` | F9 (ciclo corrigido) | Runner injetado via `setBotRunner` (FIRST-WINS) |
| Jobs | `server/jobs.js` | F9 (ciclo corrigido) | Scheduler; injeta runner nos bots |
| MCP | `server/mcp.js` | Base/F1 | Ponte MCP; scopes re-checados em `callTool` |
| Mail | `server/mail*.js` | Base | IMAP/drafts/serviço |
| AgentMail | `server/agentmail.js` | Base | Integração inbox (webhook Svix público) |
| OAuth | `server/oauth.js` | Base | Callback público fail-closed |
| Outros | `conversations.js`, `documents.js`, `memory-retention.js`, `diagnostics.js`, `skills.js`, `llm.js`, `comms.js`, `urlpolicy.js`, `unix-socket.js`, `build-info.js`, etc. | Base | Suporte à base pré-existente |

## Frontend (`src/`)

| Área | Fase | Responsabilidade |
|---|---|---|
| `src/lib/bridge.ts` | Base | Único canal HTTP painel→backend; fallback demo em localStorage |
| 11 estúdios/painéis | F1–F8 | Workforce, Knowledge, Workflow, Research/Learning, Computer, Multimodal, Proativo, Integrações, Calendário etc. (ver [ux-validation.md](ux-validation.md)) |
| `src/components/ui/` | F9 | 28 componentes mortos **removidos** nesta fase |

## Testes (`tests/`)

~93 arquivos; suítes por domínio (`wf-*`, `kh-*`, `workforce-*`, `proactive`,
`integrations`, `multimodal`, `stt`, `voice-tts`, `browser-tool`, `http-auth`,
`isolation`, `migrations`, etc.), evals em `tests/evals/` e a demo de aceite em
`scripts/demo-final-acceptance.mjs`.

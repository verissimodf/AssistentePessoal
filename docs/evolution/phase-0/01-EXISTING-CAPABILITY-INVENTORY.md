# 01 — Inventário de Capacidades Existentes

Auditoria baseada no código real (branch `evolution/phase-0-architecture-security-20261030`, base
`9aad596`, release 1.10.0, schema SQLite 19). Legenda: **IT** = implementado e testado ·
**ITI** = implementado, cobertura de teste incompleta · **P** = parcial · **DNV** = documentado
mas não verificado · **A** = ausente.

| # | Domínio | Status | Implementação (arquivos-chave) | Testes | Lacunas principais |
|---|---------|--------|-------------------------------|--------|--------------------|
| 1 | Autenticação e autorização | IT | `server/auth.js` (scopes, `isVerifiedAdmin` em `auth.js:115`, `can()` deny-by-default em `auth.js:570`); choke point único em `server/index.js:1270-1307` | `tests/auth.test.mjs` (~24), `tests/http-auth.test.mjs` (~16) + outros (~60 total) | Escopos são strings planas, sem hierarquia/expiração por escopo |
| 2 | Isolamento por admin | IT | `server/ownership.js` (rows imutáveis, claim/transfer/purge, `ownership.js:196`); `conversations` usa `admin_id` próprio (`conversations.js:83`) | `tests/isolation.test.mjs` (~13), `tests/d-rec-*.test.mjs` | Dois mecanismos paralelos de isolamento; enforcement manual por callsite, sem cobertura automática |
| 3 | Conversas e contexto | IT | `server/conversations.js` (idempotência por `client_msg_id` `:248`, compactação `:415`, streaming NDJSON `server/index.js:517-568`), `server/reflex.js` (advisory opt-in) | `tests/conversations.test.mjs` (~19), `tests/chat-stream.test.mjs` (~7) | Compactação extrativa sem sumarização LLM; Reflex fixo no provider "ollama" (`reflex.js:35`) |
| 4 | Roteamento LLM | ITI | `server/llm.js:294-521` (runAgent, fallback chain `:363-462`, deadline 5 min `:269`) | `tests/provider-deadline.test.mjs`, `tests/run-limits.test.mjs` (~30 total) | `classifyTaskIntent` (`llm.js:629-669`) não influencia escolha de provider; telemetria em memória; sem streaming de tokens |
| 5 | Execução de agentes | IT | `server/bots.js` (`botPrincipal` `:17`, concorrência 2/admin `:78-93`, scheduler 20 s `:213`) | `tests/bot-scheduler.test.mjs`, `tests/bots-authz.test.mjs` (~25) | Runs não são aninháveis; `activeBotRuns` in-memory sem noção de hierarquia |
| 6 | Tool calling | IT | `server/tools.js` (~18 tools; `callTool` revalida escopo na execução `:1026-1040`; `resolveApproval` com fingerprint `:1560-1630`) | `tests/hostpolicy.test.mjs`, `tests/approvals-actions.test.mjs` (~40) | Schemas de parâmetros tipados como string (`llm.js:73-87`); sem rate-limit por ferramenta; aprovação pendente não expira |
| 7 | Skills | ITI | `server/skills.js` (confinamento realpath `:197-240`, cap 2 MB, catálogo com cache) | `tests/skills-hub.test.mjs` (~37 total) | Checksum verificado só no provisionamento (`scripts/setup-global-skills.mjs:360`), não em runtime; skill global sem ownership; conteúdo sem marcação untrusted |
| 8 | MCP | ITI | `server/mcp.js` (7 tools, Bearer `JARVIS_SERVICE_TOKEN`, autorização no serviço local `:1-8`) | `tests/mcp.test.mjs` (~8) | Sem noção de run/budget/correlação entre chamadas; protocolo fixado `2024-11-05` |
| 9 | Memória | IT | `server/tools.js:838-901` (remember/recall híbrido), `server/memory-retention.js` (quarentena v17) | `tests/memory-retention.test.mjs`, `tests/d-rec-*.test.mjs` | Recall O(N) em JS sem índice vetorial; Gigabrain é store compartilhada fora do ownership e da retenção |
| 10 | RAG / busca | IT | `server/documents.js` (busca híbrida 0.7 semântico + 0.3 lexical `:586`; JOIN ownership `:515-525`), citações em `meta.citations` | `tests/documents-rag.test.mjs` (16) | Cosine O(N) em JS; sem FTS5; embeddings em JSON blob |
| 11 | Ingestão de documentos | IT | `server/documents.js:11-37` (txt/md/csv/json/pdf/docx; 2/10 MB; magic bytes `:352`) | `tests/documents.test.mjs` (6) | Extrator PDF regex falha fail-closed em PDFs subsetados; sem parser estruturado p/ CSV/JSON |
| 12 | Pesquisa (web) | P | `server/tools.js:251` (web_search via scraping DDG), `:497-660` (Gigabrain MCP) | `tests/gigabrain.test.mjs` (8) | **web_search/fetch_url sem teste dedicado**; scraping frágil; sem fallback de pesquisa web; Gigabrain depende de npx em runtime |
| 13 | Agendamento | IT | `server/jobs.js` (fila durável v16: lease 90 s `:50`, heartbeat 25 s, recovery `:187`), `server/bots.js:213` (dedupe v15) | `tests/bot-scheduler.test.mjs`, `tests/audit-interrupted.test.mjs` | Triggers limitados a daily/interval/file (CHECK v16); drain single-threaded in-process; retry fixo sem backoff |
| 14 | Jobs em background | ITI | `server/jobs.js:104-209` (princípio "efeito já ocorreu ⇒ nunca re-executar" `:158`) | `tests/bot-scheduler.test.mjs` | `needs_reconciliation` é terminal e manual (sem UI/fluxo); run interrompido fica órfão `running` para sempre |
| 15 | Execução de workflows | P | Apenas loop agêntico de 1 bot (`server/bots.js:112`, `maxSteps ≤ 50`) | `tests/agent-loop-e2e.test.mjs` | **Sem engine de workflows**: zero ocorrências de "workflow" em `server/`; sem DAG, steps declarativos, encadeamento, checkpoints |
| 16 | Automação de navegador | IT | `server/browser.js` (ops fechadas `:27`, SSRF `:118`, UDS `:50`), `server/browser-egress-policy.js` (grants ≤65 s), v19 criptografa fills | `tests/browser-tool.test.mjs` (27), `tests/browser-egress-proxy.test.mjs` (6) | 1 ação = 1 aprovação (sem batch p/ workflows longos); screenshots sem redação visual |
| 17 | Interação GUI (computer-use) | P | Somente navegador; `run_command` + `server/hostpolicy.js` (allowlist) | `tests/hostpolicy.test.mjs` | Nenhuma automação GUI nativa (input sintético, janelas, teclado/mouse) — capacidade nova exigiria domínio de segurança próprio |
| 18 | Voz e multimodal | IT | `server/voice.js` (fila, cancelamento), `server/stt.js` (nunca grava áudio `:1-2`), `scripts/voice-adapter-core.mjs`, perfil `stt` opt-in | `tests/voice-tts.test.mjs` (8), `tests/stt.test.mjs` (3) | Cobertura fina de STT (3 testes); streaming de voz não validado em produção |
| 19 | Aprovações | IT | `server/tools.js:919` (fila D9 congelada, v6/v19), `resolveApproval` `:1565` (portões reavaliados, claim único `:1624`) | `tests/approvals-actions.test.mjs` (13), `tests/approval-correlation*.test.mjs` | Aprovações pendentes não expiram no fluxo normal |
| 20 | Evidência de execução | IT | Ledger `execution_evidence` (v10, `migrations.js:302`), `recordEvidence` `server/db.js:309-342`, verificador nomeado (`verifiedBy`, `tools.js:1516-1549`) | `tests/execution-evidence.test.mjs` (14), `tests/audit-outcomes.test.mjs` (11) | — |
| 21 | Auditoria | IT | `server/db.js:229-234` (`audit()`), imutável por trigger (v9), allowlist de metadados `:148-179` | `tests/audit-trail.test.mjs` (8), `tests/audit-probe.test.mjs` (7) | — |
| 22 | Recuperação e idempotência | IT | `migrate` com backup `VACUUM INTO` verificado (`migrations.js:861-879`), recovery conservador (`jobs.js:188-210`), `client_msg_id` único | `tests/migrations.test.mjs` (12) + migrações (~60) | — |
| 23 | Observabilidade | ITI | `/api/health` (`index.js:263`), `/api/diagnostics` (`server/diagnostics.js`), `/api/router/telemetry` (`llm.js:748`) | `tests/diagnostics.test.mjs` (27) | Telemetria de router em memória, sem persistência/retenção; testes de telemetry ausentes |
| 24 | Retenção e privacidade | IT | `server/memory-retention.js` (opt-in v17, quarentena, purga em lotes de 50); corpos de e-mail/áudio/prompts nunca persistidos | `tests/memory-retention.test.mjs`, `tests/d-rec-purge.test.mjs` (9) | Cobertura fina (3+9 testes) relativa à criticidade |
| 25 | Deploy e resiliência | ITI | `Dockerfile` (HEALTHCHECK `:124`), `docker-compose.yml` (sem ports, cap_drop ALL, perfis opt-in), `scripts/verificar-imagem-release.sh`, `scripts/update-release.sh` | `tests/build-info.test.mjs` (11), `tests/tls-config.test.mjs` (6) | healthchecks e update-release.sh sem teste automatizado |

## Sobreposições e redundâncias

- **Dois mecanismos de isolamento** (tabela `ownership` vs `conversations.admin_id`) — não
  remover nenhum agora; novos recursos DEVEM usar a tabela `ownership` (`adr/ADR-EVO-002`).
- **Duas memórias de longo prazo** (memórias por admin + Gigabrain transversal) — a evolução
  precisa explicitar o escopo de ownership da memória compartilhada (`05`, §Gigabrain).
- **Nenhuma implementação duplicada de orquestração** — não criar segunda fila além de
  `durable_jobs`; workflows devem reutilizar a mesma infraestrutura (`adr/ADR-EVO-004`).

## Capacidades ausentes (base da Fase 1+)

1. AgentDefinition/AgentRun formais com hierarquia pai-filho e orçamento hierárquico.
2. Comunicação estruturada entre agentes (envelope tipado, sem autorização implícita).
3. Engine de workflows duráveis com steps declarativos, checkpoints e retomada.
4. Pesquisa web estruturada (motor dedicado + fallback, sem scraping frágil como única via).
5. Busca vetorial indexada (hoje O(N) em JS).
6. Política comportamental avaliável no backend (guidelines versionadas).
7. Execução GUI isolada (não implementar antes da Fase 5 — `adr/ADR-EVO-008`).

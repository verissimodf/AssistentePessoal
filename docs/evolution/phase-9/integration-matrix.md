# Matriz de Integração (§5) — Fase 9

Matriz de integração dos 10 módulos centrais, em cinco dimensões: **API**, **Persistência**,
**Autorização**, **Auditoria** e **E2E**. Valores: **PASS** (coberto por teste e/ou
passo de demo) ou **PARTIAL** (funcional, com limitação declarada). Evidências citam
o arquivo de teste ou o passo da demo de aceite (`scripts/demo-final-acceptance.mjs`).

| Módulo | API | Persistência | Autorização | Auditoria | E2E |
|---|---|---|---|---|---|
| **1. Auth/Sessões** (`auth.js`) | PASS — rotas `login`/`setup` públicas asseridas; resto 401 (`tests/http-auth.test.mjs`) | PASS — sessões em SQLite; migrações v1–v28 | PASS — SCOPES deny-by-default; `isVerifiedAdmin()`; testes `auth.test.mjs`, `cookie-secure.test.mjs` | PASS — eventos de auth no audit central | PASS — demo-passos 1–4 (auth real) |
| **2. Ownership** (`ownership.js`) | PASS — nenhuma rota expõe recursos alheios | PASS — tabela imutável (trigger), migração v2 | PASS — `owns()` ou `owner_admin_id` na query em todas as tabelas novas | PASS — origem (`created/migrated/claimed`) registrada | PASS — demo-passos de isolamento cross-owner em todos os módulos; `tests/isolation.test.mjs` |
| **3. Workforce** (`workforce.js`) | PASS — delegação e orçamento via rotas com escopo | PASS — v20 | PASS — `workforce-security.test.mjs` | PASS — `agent-audit.test.mjs` | PASS — demo: workforce com orçamento |
| **4. Knowledge Hub** (`knowledge.js`) | PASS — ingest/busca com escopo | PASS — v21, FTS5 + cosine | PASS — `kh-security.test.mjs` | PASS — `kh_jobs` auditáveis | PASS — demo: KH ingest + busca FTS5 real |
| **5. Workflow Engine** (`workflow.js`) | PASS — fluxos com `REQUIRE_APPROVAL` | PASS — v22 (`wf_runs` indexado na v28) | PASS — `wf-security.test.mjs`; Policy Engine no caminho | PASS — `execution-evidence.test.mjs` | PASS — demo: workflow **real** com D9 real (`resolveApproval` + fingerprint) |
| **6. Proactive Engine** (`proactive.js`) | PASS — regras/oportunidades/notificações | PASS — v26 (+ índices v28) | PASS — `proactive.test.mjs`; ownership por regra | PASS — justificativa + evidências registradas | PASS — demo: regra→evento→oportunidade→aceite→workflow |
| **7. Integration Fabric** (`integrations.js`) | PASS — webhook público autenticado por HMAC | PASS — v27 (`if_events` indexado na v28) | PASS — assinatura autentica, não autoriza; segredo 1× | PASS — evento aceito/rejeitado auditado | PASS — demo: webhook HMAC aceito/rejeitado; regressão irmãs nº 36 (`tests/integrations.test.mjs`) |
| **8. Calendar** (`calendar.js`) | PARTIAL — provider `fixture` pleno; `google` exige OAuth real (`cal_oauth_not_connected` sem conexão) | PASS — v27 (`cal_conflicts` indexado na v28) | PASS — contas por owner | PASS — sincronizações auditadas | PASS (fixture) — demo: calendário fixture + timezone/recorrência; `google` pendente de credencial |
| **9. Multimodal** (`multimodal.js`, `stt.js`, `voice.js`) | PASS — sessões/turnos/eventos | PASS — v25 (+ índices v28) | PASS — sessões por owner; `tests/multimodal.test.mjs` | PASS — eventos de turno auditados; **sem áudio persistido** | PARTIAL — demo: multimodal com STT fixture/interrupção; TTS real comprovado na F6; STT real pendente de infra |
| **10. Computer Intelligence** (`computer.js`, `browser*.js`) | PASS — sessões CI com D9 nativo | PASS — v24 (`ci_*` indexados na v28) | PASS — egress policy + D9; `tests/browser-tool.test.mjs`, `browser-egress-proxy.test.mjs` | PASS — ações `ci_actions` auditadas | PASS — demo: CI observe em browser isolado UDS (worker fake declarado) |

## Notas de leitura

- **PARTIAL** sempre acompanha a limitação explícita e o link para
  [limitations.md](limitations.md) — nunca é falha silenciosa.
- A dimensão **Autorização** refere-se ao tripé SCOPES (rotas) + ownership (linhas) +
  D9/Policy (ações sensíveis), detalhado em [authorization-audit.md](authorization-audit.md).
- A dimensão **E2E** refere-se à demo de aceite final (37/37); passos discriminados em
  [e2e-report.md](e2e-report.md).

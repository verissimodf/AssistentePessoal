# 🏛️ Arquitetura do Sistema e Fluxo de Dados

Documento atualizado para a release **1.7.8** (esquema SQLite **12**). Descreve a topologia real,
os componentes e os limites de confiança. Para configuração, ver `docs/CONFIGURACAO.md`.

---

## 1. Topologia de produção

```text
Internet
  └─ Cloudflare (TLS 1.2/1.3, HSTS, WAF)
       └─ cloudflared (túnel no host, systemd)
            └─ nginx-app :80  (rede Docker CNC_APP_PROD_01)
                 ├─ /api/  -> assistente-pessoal:7777
                 └─ /      -> assistente-pessoal:8090
                      └─ volume persistente -> /app/data
```

- **Um container de aplicação** (`assistente-pessoal`) serve API e painel; não há `ports:` no
  host. A exposição pública é responsabilidade do Nginx + Cloudflare.
- O container roda como **UID/GID 1000**, com `no-new-privileges` e `cap_drop: ALL`; o IP é fixo
  na rede Docker privada (`<ip-interno>` nesta instalação).
- O volume `/opt/laytech-ai/AssistentePessoal/data` contém `jarvis.db` (+ WAL/SHM),
  `master.key` (600), `voices/`, `backups/`, documentos e o store do Gigabrain.
- O hub de skills fica em `$HOME/.agent-skills` **dentro do container** e é sincronizado no boot
  a partir de `skills/vendor/` (imagem). Não é um volume persistente.

### Desenvolvimento local

```text
Navegador -> Vite (8080) -> API Node (127.0.0.1:7777) -> SQLite em ./data
                              └─ ponte de voz (7778) -> xtts-service (opcional)
```

O painel e a API são processos separados no modo local; em produção o entrypoint sobe API, ponte
de voz e painel no mesmo container e encerra o conjunto se um componente morrer.

---

## 2. Componentes

| Camada | Módulo | Responsabilidade |
| --- | --- | --- |
| HTTP/API | `server/index.js` | rotas, autenticação, CSRF, escopos, CORS/Origin, erros |
| Auth | `server/auth.js` | sessões, tokens de serviço, escopos, `isVerifiedAdmin` |
| Banco | `server/db.js`, `server/migrations.js` | SQLite WAL, migrações versionadas, backup verificado |
| Settings | `server/settings.js` | configuração pessoal/global, AES-256-GCM, proveniência |
| Ownership | `server/ownership.js` | isolamento por administrador e transferência explícita |
| LLM/router | `server/llm.js` | providers, fallback, timeouts, telemetria, testes de provider |
| Agentes/ferramentas | `server/tools.js`, `server/bots.js` | tool calling, autonomia, aprovações, auditoria |
| Host | `server/hostpolicy.js` | allowlist/negação de comandos e ações no host |
| Skills | `server/skills.js`, `scripts/setup-global-skills.mjs` | catálogo, carregamento sob demanda, checksums, confinamento |
| Integrações HTTP | `server/http-integration.js` | allowlist de integração, timeout, limite de prompt/resposta |
| Comunicações | `server/comms.js`, `server/mail-service.js` | Telegram/WhatsApp/Signal, IMAP/SMTP, calendário |
| RAG | `server/documents.js` | ingestão, chunks, embeddings, busca híbrida |
| Voz | `scripts/voice-adapter.mjs`, `server/voice.js` | TTS local/remoto e ponte de voz |
| Painel | `src/` (React/TanStack/Vite/Nitro) | UI, bridge HTTP, estados de saúde/diagnóstico |

---

## 3. Fluxo de uma mensagem

1. O painel envia `POST /api/chat` com cookie de sessão e `X-Jarvis-CSRF`.
2. O servidor valida origem, sessão, CSRF e escopo; resolve o agente e o provedor.
3. O router monta o contexto (instruções, memória/RAG, histórico compactado) e chama o provedor
   com timeout e fallback para o próximo provider elegível.
4. Se o modelo pedir uma ferramenta, `callTool` revalida o escopo **no momento da execução**;
   ações de host entram na fila de aprovação quando a autonomia exige.
5. A resposta é persistida na conversa; a auditoria registra metadados (nunca prompt/conteúdo).
6. TTS (quando habilitado) recebe o texto e devolve áudio; o painel reproduz.

Falhas de provider são tipadas e não vazam payload/chave nos logs. O fallback local (Ollama) é o
caminho seguro quando um gateway externo está indisponível.

---

## 4. Skills: descoberta e carregamento

- Catálogo em `JARVIS_GLOBAL_SKILLS_DIR/catalog.json`; cada skill em
  `skills/<id>/SKILL.md` (referências em `skills/<id>/references/`).
- `GET /api/skills` lista/busca; `GET /api/skills/:id` carrega; as ferramentas `load_skill`
  (chat/MCP) fazem o mesmo sob o escopo `skills:read`.
- O provisionamento é offline e falha fechado: valida `manifest.json` + `SHA256SUMS`, copia para
  staging, troca por `rename` e só então grava o catálogo. Skills de terceiros são preservadas.
- Conteúdo Markdown é **dado não confiável**: não é executado, não altera permissões e não entra
  no system prompt permanente. Caminhos são confinados por `realpath`; symlink para fora,
  travessia e arquivos > 2 MiB são recusados.
- Estado atual: **11 skills** (4 embutidas + 7 vendorizadas de `addyosmani/agent-skills@aeac41d4`).

---

## 5. Segurança e limites de confiança

| Limite | Controle |
| --- | --- |
| Internet → edge | TLS/HSTS/WAF Cloudflare; Nginx só na rede Docker |
| Cliente → API | sessão `HttpOnly`/`SameSite=Strict`, CSRF, Origin allowlist |
| API → recursos | escopos de rota e de ferramenta reavaliados; `ownership` por admin |
| Agente → host | `hostpolicy`, allowlist, aprovação humana, auditoria imutável |
| Skills/LLM → filesystem | confinamento de caminho, sem execução, limite de tamanho |
| API → integrações | URL da configuração (admin), Bearer do settings, timeout/limite |
| Segredos | AES-256-GCM em repouso; `master.key` 600; nunca em logs/relatórios |

Rotas públicas são apenas `GET /api/health`, `POST /api/auth/setup` e `POST /api/auth/login`.
Tudo o mais exige sessão/token e escopo. O CSRF é obrigatório em toda mutação com cookie.

---

## 6. Dados e migrações

- SQLite nativo (`node:sqlite`) em WAL, `busy_timeout=5000`, transações `BEGIN IMMEDIATE`.
- `PRAGMA user_version` é a versão do schema; a release 1.7.8 usa **12** (`document_chunks`).
- Cada migração roda em transação, compara contagens/hashes das tabelas preservadas e exige backup
  verificado antes de alterar. Falha → rollback e erro explícito.
- `master.key` é obrigatória para decifrar settings; o backup precisa incluir banco **e** chave.

---

## 7. Observabilidade e operação

- `/api/health` (público) expõe `ok`, versão, commit/status, build time, modo, esquema efetivo e
  `setupRequired`.
- `/api/diagnostics` (sessão) inventaria providers, integrações, skills, contagens e integridade.
- `/api/router/telemetry` (escopo `skills:read`) expõe chamadas, falhas, latência e fallbacks.
- Docker healthcheck, logs do container, auditoria e `PRAGMA integrity_check` são as fontes
  disponíveis. Não há Prometheus/Grafana instalados; SLOs e alertas propostos estão em
  `docs/OPERACAO-SLO-E-INCIDENTES.md`.

---

## 8. Deploy e rollback

- Build multi-stage (`Dockerfile`), runtime `node:22.22-bookworm-slim`, `tini`, usuário 1000.
- Metadados de build vêm de `BUILD_VERSION`/`BUILD_COMMIT`/`BUILD_COMMIT_STATUS`/
  `SCHEMA_VERSION`; o processo não infere commit do branch.
- Compose ativo: `docker-compose.yml` (serviço `assistente`), imagem `assistente-pessoal:<sha>`.
- Rollback: `IMAGE_TAG=<tag-anterior> docker compose -f docker-compose.yml up -d --no-build`,
  mantendo banco + `master.key` compatíveis. Runbook: `docs/RUNBOOK-RELEASE-2026-10-18.md`.

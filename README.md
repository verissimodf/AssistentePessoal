# 🤖 AssistentePessoal (J.A.R.V.I.S.) — v1.8.1

[![Version](https://img.shields.io/badge/version-1.8.1-blue.svg?style=flat-square)](package.json)
[![Node.js](https://img.shields.io/badge/node-%3E%3D22.13-brightgreen.svg?style=flat-square&logo=node.js)](https://nodejs.org/)
[![Test Suite](https://img.shields.io/badge/tests-632%20backend%20%2B%20109%20frontend-success.svg?style=flat-square)](tests/)
[![Schema](https://img.shields.io/badge/schema-14-informational.svg?style=flat-square)](server/migrations.js)
[![Privacy](https://img.shields.io/badge/privacy-local--first-blueviolet.svg?style=flat-square)](#-segurança-e-privacidade)
[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg?style=flat-square)](LICENSE)

O **AssistentePessoal (J.A.R.V.I.S.)** é um assistente pessoal local com painel web, voz, RAG,
memória, agentes e integrações com serviços da máquina. O desenho padrão é **local-first**:
dados, banco, documentos, memórias e segredos ficam na máquina do operador; chamadas externas só
acontecem quando o provedor/integração correspondente está configurado e habilitado.

> **Estado atual:** release **1.8.1** publicada e implantada, esquema SQLite **14**, container
> `healthy` e smoke test de API/painel aprovado em 2026-10-27. A inbox AgentMail desta instalação
> já foi reivindicada explicitamente; novas inboxes legadas também exigem claim no painel. Evidências em
> [`HOMOLOGACAO_STATUS.md`](HOMOLOGACAO_STATUS.md).
> Ver [`HOMOLOGACAO_STATUS.md`](HOMOLOGACAO_STATUS.md) e
> [`reports/JARVIS-AGENT-SKILLS-INTEGRATION-02.md`](reports/JARVIS-AGENT-SKILLS-INTEGRATION-02.md).

---

## 📑 Sumário

- [Arquitetura](#-arquitetura)
- [Requisitos](#-requisitos)
- [Instalação local](#-instalação-local)
- [Produção com Docker](#-produção-com-docker)
- [Configuração](#-configuração)
- [Segurança](#-segurança-e-privacidade)
- [Banco, backup e recuperação](#-banco-backup-e-recuperação)
- [Skills e MCP](#-skills-e-mcp)
- [Provedores de IA](#-provedores-de-ia)
- [Voz, e-mail e Telegram](#-voz-e-mail-e-telegram)
- [OpenClaw, OmniRoute e Headroom](#-openclaw-omniroute-e-headroom)
- [Testes](#-testes)
- [Build, release e healthcheck](#-build-release-e-healthcheck)
- [Documentação](#-documentação)

---

## 🏗 Arquitetura

### Produção (estado validado)

```text
Internet
  └─ Cloudflare (TLS/HSTS no edge)
       └─ cloudflared (túnel no host)
            └─ nginx-app :80  (rede Docker CNC_APP_PROD_01)
                 ├─ /api/  -> assistente-pessoal:7777
                 └─ /      -> assistente-pessoal:8090
                      └─ volume /opt/laytech-ai/AssistentePessoal/data -> /app/data
```

- Um único container de aplicação serve API e painel; **nenhuma porta é publicada no host**.
- O container roda como UID/GID 1000, com `no-new-privileges` e `cap_drop: ALL`.
- O volume persistente contém `jarvis.db`, `master.key`, `voices/`, `backups/`, documentos e o
  store do Gigabrain. O hub de skills fica em `$HOME/.agent-skills` dentro do container e é
  sincronizado no boot a partir de `skills/vendor/`.
- O Nginx ativo e o túnel Cloudflare são infraestrutura do host, fora do repositório.

### Desenvolvimento local

```text
Navegador -> Vite (8080) -> API Node (127.0.0.1:7777) -> SQLite em ./data
                              └─ ponte de voz (7778) -> xtts-service (opcional)
```

O backend é Node.js puro (`node:http`) com `node:sqlite`; o painel é React 19 + TanStack Router,
buildado com Vite/Nitro. O frontend fala com a API por HTTP (`src/lib/bridge.ts`).

---

## ✅ Requisitos

- **Node.js 22.13+** (o runtime usa `node:sqlite`; a imagem usa `node:22.22-bookworm-slim`).
- npm 11+ para instalar dependências.
- Docker + Docker Compose para produção (o compose usa a rede externa `CNC_APP_PROD_01`).
- Opcional: Ollama para inferência 100% local; Python 3.10–3.12 para TTS local XTTS/Kokoro;
  Cloudflare/Nginx para exposição HTTPS.

---

## 🚀 Instalação local

```bash
git clone https://github.com/verissimodf/AssistentePessoal.git
cd AssistentePessoal
npm ci
(cd server && npm ci)

# API (terminal 1)
cd server && npm start

# painel em modo dev (terminal 2, na raiz)
npm run dev
```

O painel de desenvolvimento abre em `http://localhost:8080` e a API em
`http://127.0.0.1:7777`. No primeiro acesso, o serviço cria um código de uso único em
`data/bootstrap-token.txt` (permissão 0600); use-o para criar o primeiro administrador no painel.
O arquivo é consumido e removido após o setup.

Para build de produção local:

```bash
NITRO_PRESET=node-server npm run build
```

---

## 🐳 Produção com Docker

O compose ativo é [`docker-compose.yml`](docker-compose.yml) (serviço `assistente`).

```bash
cd /opt/laytech-ai/AssistentePessoal
# build com metadados de release (ver docs/RUNBOOK-RELEASE-2026-10-18.md)
export BUILD_VERSION="$(node -p 'require("./package.json").version')"
export BUILD_COMMIT="$(git rev-parse HEAD)"
# Em build local ainda não publicado; use Registrado somente após merge/tag no remoto.
export BUILD_COMMIT_STATUS="Não registrado (local)"
export SCHEMA_VERSION=14
export BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export RELEASE_BUILD=1
export IMAGE_TAG="$(git rev-parse --short HEAD)"
docker compose -f docker-compose.yml build
docker compose -f docker-compose.yml up -d --no-build
curl -s http://<ip-interno>:7777/api/health
```

O healthcheck do container consulta `/api/health` no IP interno. O entrypoint sincroniza o hub de
skills (`scripts/setup-global-skills.mjs --sync-bundled`), sobe API, ponte de voz e painel, e
encerra o conjunto se um componente cair (o Docker reinicia).

---

## ⚙️ Configuração

A configuração de aplicação é feita no painel e persistida cifrada em `data/jarvis.db`. As
variáveis de ambiente são de infraestrutura/segurança:

| Variável | Uso |
| --- | --- |
| `JARVIS_DATA_DIR` | diretório de dados (`/app/data` no container) |
| `JARVIS_HOST` / `JARVIS_PORT` | bind da API (o entrypoint descobre o IP do container; nunca `0.0.0.0`) |
| `PANEL_PORT` | porta do painel no container (8090) |
| `JARVIS_ALLOWED_ORIGINS` | origens permitidas para o painel/API, separadas por vírgula |
| `JARVIS_COOKIE_SECURE` | `1` para cookie `Secure` quando servido por HTTPS |
| `JARVIS_MAX_UPLOAD` / `JARVIS_MAX_DOCUMENT` | limites de upload/documento |
| `JARVIS_MASTER_KEY` | chave mestra alternativa ao `data/master.key` (não versionar) |
| `JARVIS_SERVICE_TOKEN` | token de serviço para MCP/scripts (criado no painel) |
| `JARVIS_GLOBAL_SKILLS_DIR` | diretório do hub de skills (padrão `$HOME/.agent-skills`) |
| `JARVIS_SKILLS_SETUP` | `builtin` (padrão), `off` ou `full` (modo de rede opt-in) |
| `JARVIS_MAIL_TRANSPORT` | `imap` ativa o adaptador real de e-mail; ausente = mock |
| `XTTS_URL` | endpoint do serviço de voz local (padrão `http://xtts-service:8000`) |

Detalhes de provedores, integrações, canais e proveniência de valores:
[`docs/CONFIGURACAO.md`](docs/CONFIGURACAO.md).

---

## 🔒 Segurança e privacidade

- **Autenticação:** sessão de administrador em cookie `HttpOnly`, `SameSite=Strict`, expiração por
  inatividade (30 min) e absoluta (12 h), rotação no login e revogação no servidor.
- **CSRF:** toda requisição mutável com cookie exige `X-Jarvis-CSRF` vinculado à sessão (inclusive
  logout). Origem/CORS é defesa adicional, não autenticação.
- **Escopos:** rotas e ferramentas exigem escopos (`skills:read`, `documents:*`, `memories:*`,
  `host:run`, etc.); o escopo é reavaliado no momento da execução em chat, MCP, bots e canais.
- **Isolamento multi-admin:** propriedade explícita na tabela `ownership`; linhas sem dono são
  invisíveis; poderes administrativos exigem sessão verificada (`isVerifiedAdmin`).
- **Host:** comandos começam desabilitados; ações passam por `server/hostpolicy.js` e, quando
  aplicável, por aprovação humana no painel. Não há shell/execução arbitrária exposta a agentes.
- **Skills:** conteúdo Markdown externo é tratado como dado não confiável, carregado sob demanda,
  com confinamento de caminho (`realpath`), bloqueio de symlink/travessia e limite de 2 MiB.
- **Segredos:** chaves e tokens ficam cifrados com AES-256-GCM; `data/master.key` é obrigatória
  para restaurar o banco. Nunca versione `data/`, `.env` ou a chave mestra.
- **Rede:** em produção o container só é alcançável pela rede Docker privada; a exposição pública
  é feita pelo Nginx/Cloudflare, com HSTS no edge. Não publique `7777`/`8090` diretamente.

Relate vulnerabilidades conforme [`SECURITY.md`](SECURITY.md). Não abra issue pública com detalhes
de exploração.

---

## 💾 Banco, backup e recuperação

- SQLite nativo em WAL, esquema **14** (`PRAGMA user_version`), migrações versionadas com backup
  verificado antes de alterar o schema.
- Backup consistente: `VACUUM INTO` (ou `.backup`) do banco **e** cópia de `master.key`; sem a
  chave o serviço não inicia. Ver [`docs/BACKUP-E-RESTAURACAO.md`](docs/BACKUP-E-RESTAURACAO.md) e
  o runbook de deploy [`deploy/BACKUP-RESTORE.md`](deploy/BACKUP-RESTORE.md).
- O timer `jarvis-data-backup.timer` está instalado/habilitado; o script `deploy/backup-data.sh`
  (modo executável corrigido) mantém os 7 backups mais recentes no mesmo disco, com checksums de
  banco + chave + vozes. Cópia externa existe como opt-in (`JARVIS_BACKUP_REMOTE`, fail-soft);
  o OAuth do remote `gdrive:` está pendente de reversão. RPO/RTO e cifragem antes da
  transferência continuam propostas pendentes de aprovação (ver documento de backup).

---

## 🧩 Skills e MCP

O hub nativo fica em `JARVIS_GLOBAL_SKILLS_DIR` (`$HOME/.agent-skills`) com `catalog.json` e
`skills/<id>/SKILL.md`.

- **11 skills no catálogo atual:** 4 embutidas (`threejs-expert`, `gsap-motion`, `design-dna`,
  `karpathy-engineering`) + 7 vendorizadas de `addyosmani/agent-skills@aeac41d4`
  (`security-and-hardening`, `test-driven-development`, `code-review-and-quality`,
  `spec-driven-development`, `debugging-and-error-recovery`, `incremental-implementation`,
  `context-engineering`).
- O provisionamento é offline, idempotente e falha fechado: valida `manifest.json` e
  `SHA256SUMS` antes de copiar; preserva skills de terceiros.
- Descoberta: `GET /api/skills`; carregamento: `GET /api/skills/:id`, ferramenta `load_skill` e
  MCP `load_skill`. Referências relativas são listadas e carregadas pelo mesmo loader.
- MCP stdio: `server/mcp.js` (configure `JARVIS_SERVICE_TOKEN` com escopos mínimos). Exemplo de
  configuração em [`docs/CONFIGURACAO.md`](docs/CONFIGURACAO.md).

Origem, hashes e procedimento de atualização/remoção:
[`skills/vendor/addyosmani-agent-skills/PROVENANCE.md`](skills/vendor/addyosmani-agent-skills/PROVENANCE.md).

---

## 🤖 Provedores de IA

O roteador multi-provedor (`server/llm.js`) suporta Ollama, OpenAI, Anthropic, Gemini, Groq,
OpenRouter, HuggingFace, OpenCode Go, OpenWebUI, OmniRoute, Headroom e endpoints compatíveis com
OpenAI. O estado de cada integração depende de configuração e de uma chamada real bem-sucedida;
não presuma que o adaptador existe = integração operacional.

Estado verificado em 2026-10-26 (sem alterar configuração):

| Provedor | Estado | Evidência |
| --- | --- | --- |
| Ollama | **OPERATIONAL** | `/models` 200, 9 modelos; chat real via agente |
| Headroom | **OPERATIONAL** | `/models` 200, 9 modelos; chat sintético 200 (~6,4 s) |
| OmniRoute | **OPERATIONAL** | `/models` 200, 268 modelos; chat real 200 (`auto/best-coding` → `Beam-1.0-501B-A23B`, resposta `PONG`) |
| Hermes | **PASS-WITH-CONDITIONS** | `/models` 200, 1 modelo; chat depende do gateway/sessão |
| OpenClaw | **BLOCKED-CONFIGURATION** | `/healthz` 200, `/models` 200; `/v1/chat/completions` 404 (endpoint desabilitado no gateway) |
| OpenAI / Anthropic | **BLOCKED-CONFIGURATION** | exigem chave configurada; sem teste real |

---

## 🎙 Voz, e-mail e Telegram

- **Voz/TTS:** o painel usa Web Speech API; o backend pode usar XTTS/Kokoro local via
  `xtts-service` ou ElevenLabs. O adaptador de voz está em `scripts/voice-adapter.mjs`.
- **E-mail:** `JARVIS_MAIL_TRANSPORT` ausente mantém o transporte **mock**. A conta Gmail está
  configurada, mas o login IMAP real falhou na auditoria (`authenticationFailed`); envio real não
  foi testado. Ver estado e pendências em [`docs/CONFIGURACAO.md`](docs/CONFIGURACAO.md).
- **AgentMail:** integração server-side com webhook Svix, leitura sob demanda e envio de agente
  mediante aprovação D9. A inbox precisa de reivindicação explícita por administrador após a
  migração v14; o corpo do e-mail não é persistido. O MCP AgentMail remoto configurado diretamente
  não passa pelos controles do Jarvis; use as ferramentas integradas para acesso protegido.
- **Telegram:** conta habilitada com token/chat configurados, mas `getMe` retornou HTTP 404 na
  auditoria (token inválido ou revogado). Nenhuma mensagem foi enviada. Reconfigure o token no
  painel antes de usar.

---

## 🔌 OpenClaw, OmniRoute e Headroom

- **OpenClaw** é uma integração HTTP (`kind: "http"`) configurada para
  `http://openclaw:18789/v1`, com token presente. O gateway responde `/healthz` e `/models`, mas
  `gateway.http.endpoints` está `null` e `/v1/chat/completions` retorna 404. O código
  (`server/http-integration.js`) já tem allowlist, timeout, limite de prompt/resposta e logs sem
  segredos; falta habilitar o endpoint de chat no gateway. Detalhes em
  [`INTEGRACOES-LAYTECH.md`](INTEGRACOES-LAYTECH.md).
- **OmniRoute** é um gateway independente (`http://omniroute:20128/v1`) com 268 modelos e
  `auto/best-coding`. Chat conversacional validado em 2026-10-26 com as credenciais existentes
  (HTTP 200, resposta verificável; sem alteração de configuração). O fallback local (Ollama)
  permanece o caminho seguro e não há loops infinitos de retry.
- **Headroom** é um proxy local independente (`http://headroom:8787/v1`) com 9 modelos e chat
  sintético validado. Ele não substitui o OmniRoute; são camadas complementares.

---

## 🧪 Testes

```bash
# backend (Node test runner)
node --no-warnings --test tests/*.test.mjs

# frontend (Vitest)
npx vitest run

# build de produção
npm run build

# integridade das skills vendorizadas
(cd skills/vendor/addyosmani-agent-skills && sha256sum -c SHA256SUMS)
```

Última validação local registrada em 2026-10-27: backend **632/632**, frontend **109/109**,
TypeScript sem erros e build Vite/Nitro de produção OK. O lint continua com dívida de formatação e
algumas regras em arquivos existentes; evidência e status do container em
[`HOMOLOGACAO_STATUS.md`](HOMOLOGACAO_STATUS.md).
O CI do GitHub Actions executa Ubuntu, Windows e build/inicialização do container; o job Windows
depende de `.gitattributes` para preservar LF nas skills.

---

## 🩺 Build, release e healthcheck

`GET /api/health` é público e minimalista:

```json
{
  "ok": true,
  "version": "1.8.1",
  "commit": "4556df8db445d5c54f1f49998015eba83e1f5486",
  "buildTime": "2026-10-27T20:41:49Z",
  "mode": "production",
  "schemaVersion": 14,
  "schemaVersionBuild": 14,
  "commitStatus": "Registrado",
  "setupRequired": false
}
```

- `schemaVersion` é o `PRAGMA user_version` efetivo do banco; `schemaVersionBuild` é o valor
  declarado no build.
- `commitStatus` é metadado **injetado no build**, não uma checagem de Git em runtime. Use
  `Registrado` após merge/tag remota e `Não registrado (local)` em build local.
- Diagnóstico operacional autenticado: `GET /api/diagnostics` (sessão de administrador).
- Telemetria do roteador: `GET /api/router/telemetry` (escopo `skills:read`).
- Runbook de release e verificação de imagem:
  [`docs/RUNBOOK-RELEASE-2026-10-18.md`](docs/RUNBOOK-RELEASE-2026-10-18.md) e
  `scripts/verificar-imagem-release.sh`.

---

## 📚 Documentação

Índice completo em [`docs/INDICE.md`](docs/INDICE.md). Principais entradas:

- [`docs/ARQUITETURA.md`](docs/ARQUITETURA.md) — topologia, fluxo e componentes.
- [`docs/CONFIGURACAO.md`](docs/CONFIGURACAO.md) — provedores, integrações, canais e variáveis.
- [`docs/BACKUP-E-RESTAURACAO.md`](docs/BACKUP-E-RESTAURACAO.md) — backup, retenção, RPO/RTO e restore.
- [`docs/OPERACAO-SLO-E-INCIDENTES.md`](docs/OPERACAO-SLO-E-INCIDENTES.md) — SLOs propostos e runbook.
- [`docs/RUNBOOK-RELEASE-2026-10-18.md`](docs/RUNBOOK-RELEASE-2026-10-18.md) — release/deploy.
- [`HOMOLOGACAO_STATUS.md`](HOMOLOGACAO_STATUS.md) — homologação e histórico.
- [`reports/JARVIS-AGENT-SKILLS-INTEGRATION-02.md`](reports/JARVIS-AGENT-SKILLS-INTEGRATION-02.md) — evidência 1.7.8.

---

## 📄 Licença

Distribuído sob a licença **Apache 2.0**. Consulte [`LICENSE`](LICENSE).

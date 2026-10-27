# 📝 Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo. O formato é baseado no [Keep a Changelog](https://keepachangelog.com) e este projeto adere ao [Semantic Versioning](https://semver.org).

---

## [1.8.1] — 2026-10-27

### Segurança e corrigido
- AgentMail passa a respeitar isolamento por administrador: inbox com ownership explícito,
  histórico filtrado pelo proprietário e rotas/ferramentas restritas à inbox configurada.
- Novo endpoint de reivindicação explícita; registros históricos não recebem proprietário
  automaticamente. Aprovações de envio são invalidadas se a inbox mudar antes da confirmação.
- Corrigida a leitura do histórico de eventos (`SELECT` usa `.all()`, não metadados de `.run()`).
- Corrigidos erros de tipos, hooks e testes de componentes que impediam `tsc`/lint direcionado.
- Documentação operacional atualizada para a 1.8.1: arquitetura, configuração, backup, validação,
  integrações e roadmap; a especificação antiga de e-mail foi marcada como histórica.

### Migração e validação
- Migração v14 cria o registro de inboxes e amplia o tipo de ownership preservando linhas já
  existentes; backup verificado continua sendo requisito de migração.
- Backend **632/632**, frontend **109/109**, TypeScript limpo, build de produção concluído e
  configuração Compose válida; `npm audit` produção sem vulnerabilidades.
- Publicada em `origin/main` e reconstruída em 2026-10-27 como `assistente-pessoal:1.8.1`, commit
  `4556df8` (manifest `sha256:45ba84fe…`). `/api/health` confirmou versão/commit/schema 14,
  painel HTTP 200, SQLite íntegro, zero violações FK e container `healthy` sem reinícios.
- Inbox AgentMail reivindicada explicitamente (`ownership.origin=claimed`); zero eventos sem owner.
  Não houve leitura de conteúdo nem envio real nesta validação.

## [1.8.0] — 2026-10-27

### Adicionado
- **Integração server-side AgentMail** (`server/agentmail.js`): cliente REST `https://api.agentmail.to/v0`
  (`Authorization: Bearer`, timeout 10 s, erros instantâneos e sem vazar credencial), verificação de
  webhook **Svix** com `node:crypto` (HMAC-SHA256, janela de 5 min, comparação em tempo constante —
  sem dependência nova) e config por `global_settings.integrations.agentmail` com fallback de
  ambiente (`AGENTMAIL_API_KEY` / `AGENTMAIL_WEBHOOK_SECRET` / `AGENTMAIL_INBOX_ID`).
- **Rota pública `POST /api/integrations/agentmail/webhook`** para o evento `message.received`:
  assinatura verificada sobre o corpo BRUTO (novo suporte `route(..., { raw: true })` no dispatcher),
  dedupe por `svix-id` e persistência de **somente metadados** do envelope — o corpo do e-mail
  jamais vai ao banco; conteúdo é lido sob demanda, com escopo `comms:read`.
- **Rotas de administração (session)**: `GET /api/integrations/agentmail/status` (presença de segredo,
  nunca o valor), `POST /api/integrations/agentmail/webhook-register` (cria a assinatura na
  AgentMail e grava o segredo direto no `global_settings`, sem expô-lo na resposta) e
  `GET /api/integrations/agentmail/events|messages` (`comms:read`).
- **Ferramentas do agente**: `agentmail_read_email` (`comms:read`; metadados marcados como DADO NÃO
  CONFIÁVEL) e `agentmail_send_email` (`comms:send`; **D9** — nunca envia direto: enfileira
  aprovação humana; `resolveApproval` revalida gate + impressão digital no momento da aprovação e
  registra evidência `verified/provider_message_id`).
- **Migração v13**: tabela `agentmail_events` (PK `svix_id`; apenas metadados). Deploys passam a
  declarar `SCHEMA_VERSION=13`.
- **Release 1.8.0 em produção** (2026-10-27): imagem `assistente-pessoal:837e2f0`, migração
  v12→v13 com backup verificado, health `ok/healthy`. Webhook registrado no provider em
  2026-10-27 (`webhook_id: ep_3LI5BKyF1itW99uDsILhV3w5OjQ`); E2E real de ponta a ponta:
  entrega `message.received` assinada aceita, dedupe e envio D9 com evidência
  `verified(provider_message_id)`. Rollback: tag `a978f59`.
- Correção histórica: os 5 testes do script de build (`tests/build-info.test.mjs`) resolviam o
  caminho do script com `process.cwd()` e falhavam quando a suíte rodava de `server/` — os
  caminhos agora ficam ancorados no arquivo de teste (`import.meta.dirname`). 11/11 verdes.
### Segurança
- A lista pública de rotas passa a incluir apenas o webhook (recebido do provider, que não
  efetua login); a rota exige assinatura Svix válida e é fail-closed com 503 quando
  desabilitada/sem segredo — `tests/http-auth.test.mjs` e `tests/agentmail.test.mjs` (8/8)
  guardam os invariantes.
- Validado de ponta a ponta com a chave real: leitura, fila D9, envio real e evidência
  `verified(provider_message_id)`; suíte completa 625/630 (as 5 falhas são pré-existentes,
  relacionadas ao script de build, e também falham no HEAD limpo).

---

## [1.7.9] — 2026-10-26

### Segurança
- **HSTS:** removido o `add_header Strict-Transport-Security` do hop HTTP interno
  (`deploy/nginx-jarvis.laytech.com.br.conf`), regressão introduzida em
  `f1965d462c3c30cb9b8d9dbea42f607a8dce2f0d` que quebrava o guardrail
  `tests/tls-config.test.mjs` (“HSTS existe somente no bloco HTTPS, com always e sem preload”)
  e o CI. A diretiva continua no bloco 443 do template TLS (`always`, sem `preload`, conforme
  o guardrail) e na borda Cloudflare em produção.
- `nodemailer` atualizado de `10.1.1` para **`10.1.4`** (pin exato) no `server/package.json` e
  lockfile, corrigindo GHSA-8c8m-p3m8-cjg8, GHSA-m943-m63m-w62w e GHSA-85x2-q946-cp5h
  (addressparser: comentários aninhados, `;` em grupo e `>` em quoted local part).
  `npm audit` do backend e da raiz: **0 vulnerabilidades**.

### Corrigido
- `deploy/backup-data.sh` versionado com modo **`100755`** (estava `100644`; o timer systemd
  falhava com `203/EXEC` desde 2026-10-25).
- `SHA256SUMS.txt` do backup passou a cobrir **todos** os artefatos incluídos (banco, chave
  mestra e vozes), sem autorreferência ao próprio manifesto.
- Cópia externa de backup **opcional e fail-soft** via `JARVIS_BACKUP_REMOTE` (rclone);
  sem destino configurado o comportamento é inalterado. Reconexão do OAuth do remote
  pendente (`rclone config reconnect gdrive:`) — armazenamento externo permanece
  **BLOCKED-CONFIGURATION**.
- `server/package.json`/`package-lock.json` alinhados na versão da release (o lock ainda dizia
  1.0.0/1.1.0).

### Adicionado
- `tests/backup-guardrail.test.mjs`: guarda o modo Git executável do script de backup, o uso de
  `VACUUM INTO`, a validação de integridade, o manifesto completo e a cópia externa opt-in.
- Validação conversacional real via **OmniRoute** (`auto/best-coding` → `Beam-1.0-501B-A23B`):
  `POST /chat/completions` **200**, resposta `"PONG"` — provedor agora **OPERATIONAL**
  (integração atualizada em `INTEGRACOES-LAYTECH.md`).

### Documentação
- README, arquitetura, configuração, backup (incl. ensaio de restauração isolado validado),
  integrações, SLOs/incidentes, índice documental e relatórios de auditoria alinhados ao estado
  real; documentos históricos preservados.

---

## [1.7.8] — 2026-10-26

### Adicionado
- **Sete skills vendorizadas** de `addyosmani/agent-skills` no commit fixado
  `aeac41d4d005999432bb7312f7ff06383a91d59d` (MIT): `security-and-hardening`,
  `test-driven-development`, `code-review-and-quality`, `spec-driven-development`,
  `debugging-and-error-recovery`, `incremental-implementation` e `context-engineering`.
  Catálogo do hub: **11 skills** (4 embutidas + 7 vendorizadas).
- `manifest.json`, `PROVENANCE.md` e `SHA256SUMS` (10 arquivos verificados) para as skills
  vendorizadas; `sha256sum -c` validado em Linux e no CI Windows (LF preservado por
  `.gitattributes`).
- Sincronização offline e idempotente do hub no boot (`setup-global-skills.mjs --sync-bundled`),
  com preservação de skills de terceiros, detecção de conflito de id/diretório e falha fechada.
- Referências relativas de skills listadas/carregadas pelo mesmo loader (`load_skill`/MCP), com
  caminho completo retornado ao agente.
- Metadados de build `BUILD_VERSION`, `BUILD_COMMIT`, `BUILD_COMMIT_STATUS` e `SCHEMA_VERSION`
  (ARG/ENV no Dockerfile); `/api/health` expõe `schemaVersion`, `schemaVersionBuild` e
  `commitStatus`; painel mostra esquema e status do commit.
- HSTS (`max-age=31536000; includeSubDomains; preload`) no vhost `jarvis.laytech.com.br`, validado
  localmente e no edge Cloudflare.

### Segurança
- Confinamento de caminho por `realpath` no hub de skills, bloqueio de symlink para fora,
  validação de nomes de referência e limite de 2 MiB por arquivo.
- `GET /api/skills/:id` mapeia `skill_too_large` para HTTP 413; escopos e rotas de skills
  permanecem `skills:read`, sem rota pública nova.
- Nenhum script/hook do upstream foi importado ou executado; conteúdo Markdown é tratado como
  dado não confiável.

### Corrigido
- Compatibilidade Windows/CRLF nos checksums das skills (`.gitattributes`).
- Deploy interino com metadados `unknown` foi detectado e corrigido pelo build final `4ad3ba2`
  com release/esquema/commit exatos.
- Compose ativo consolidado em `docker-compose.yml`; `docker-compose.jarvis.yml` removido.

### Operacional
- PR **#76**, merge `4ad3ba2`, tag `v1.7.8`, imagem `assistente-pessoal:4ad3ba2` + `:latest`
  (digest `sha256:de0017e8…`), container `healthy`/`restarts=0`.
- CI remoto 3/3 (Ubuntu, Windows, container); backend 616/616, frontend 109/109; teste HTTP
  externo 12 PASS / 0 FAIL / 0 WARN.

---


## [1.2.2] — Memória compartilhada local (Gigabrain)
### Adicionado
- Ferramentas de agente `gigabrain_recall` (escopo `memories:read`) e `gigabrain_remember` (escopo `memories:write`): camada de memória local persistente e compartilhada com o pacote oficial `@legendaryvibecoder/gigabrain@0.11.0` (MIT) via MCP sobre stdio.
- Store no volume persistente `data/gigabrain/` (SQLite + notas diárias + perfil do usuário). Bootstrap standalone idempotente no `container-entrypoint.sh` via `gigabrain-codex-setup` (só roda quando `data/gigabrain/config.json` ainda não existe; sem depender de agentes CLI detectados).
- Cada operação é um processo MCP efêmero com argv fixo (`spawn` sem shell; nenhum byte do chamador no shell); consulta e conteúdo entram como argumentos JSON únicos com limite de tamanho. O `command` do painel é documental — divergência é recusada.
- Chamadas são leitura/escrita de memória de próprio dono (sem fila de aprovação, como as memórias nativas); tokens de serviço precisam dos escopos `memories:*` e são checados no momento da execução.
- Resultado de recall apresentado como **evidência candidata** (fonte, escopo e data) com nota explícita ao agente; orientação de uso no system prompt (recall sob demanda, sempre por pedido explícito do usuário, meta `project` by default e `user` apenas para preferências pessoais).
- Cartão **Gigabrain (memória compartilhada)** em Configurações → Integrações; config da store restrito a `data/` (sem traversal).
- `@legendaryvibecoder/gigabrain@0.11.0` na imagem do container (linha dos agentes CLI, versão fixa).
- Testes: `tests/gigabrain.test.mjs` (8 casos: validação de config, recusas, ciclo real remember→recall com o pacote de publicação, comando alterado recusado, escopos de token).

## [1.2.1] — Integração REA (engenharia reversa de artefatos)
### Adicionado
- Ferramenta de agente `rea_analyze` (escopo `host:run`): análise estática de aplicativos JavaScript/Electron/ASAR com o REA (`rea-agents@6.5.0`, MIT), com todos os resultados acompanhados de Evidence.
- Fluxo idêntico às demais delegações no host: aprovação humana **sempre**, ação estruturada congelada (`kind: rea_analyze`) com revalidação de caminho/raízes/fingerprint no momento da aprovação.
- Executor sem shell (`spawn` com argv fixo `rea analyze-javascript-application <path> --json`); o campo `command` da integração no painel é documental — qualquer divergência é recusada.
- Gravação integral da saída em `data/rea/`: `<file>.json` (Evidence completa), `<file>.log` (saída cru em falhas/timeout) e `index.jsonl` (recibo por execução: caminho, exit, bytes, `evidence_id`, hora). Resumo devolvido ao agente é marcado como conteúdo não confiável.
- Cartão **REA (engenharia reversa)** em Configurações → Integrações (habilitar/desabilitar; caminho do alvo dentro de `data/rea/targets` por padrão, raízes configuráveis em `integrations.rea.roots`).
- Comando determinístico no chat: **`/rea /caminho/do/app`** enfileira a aprovação direto, **sem passar pelo LLM** (modelos locais pequenos têm tool-calling instável — medido: ≤2/4 com o catálogo completo). Sem provider configurado, também funciona. Mesmo portão de segurança (aprovação, fingerprint, raízes reavaliadas). Testes dedicados em `tests/rea-analyze.test.mjs`.
- `rea_analyze` no template de agente padrão (`DEFAULT_AGENT`) e orientação de uso no system prompt do chat (raiz de alvos, aprovação, `data/rea/`), para que o modelo saiba chamar a ferramenta.
- `rea-agents@6.5.0` na imagem do container (linha dos agentes CLI, versão fixa) + `procps` no runtime (o provider de ownership de processos do REA exige `ps` no PATH).
- Testes: `tests/rea-analyze.test.mjs` (7 casos: validação, aprovação, execução, negação, revalidação, recusa de comando alterado).

## [1.3.0] — Fase 3: gestão documental (TXT)
### Adicionado
- Armazenamento local **privado** de documentos (primeiro formato: **TXT**), com propriedade por administrador via a tabela `ownership` (migração v3).
- Validação de entrada: nome, tipo suportado, documento vazio, limite de tamanho (`JARVIS_MAX_DOCUMENT`, padrão 2 MB) e rejeição de conteúdo binário (NUL).
- Rotas `GET/POST/DELETE /api/documents` e `GET /api/documents/search`, com escopos `documents:read`/`documents:write`.
- Ferramenta de agente `document_search` (escopo `documents:read`), reavaliada no momento da execução.
- Página **Documentos** no painel (enviar, listar, buscar, ver e excluir).
- Documentos são tratados como **dados não confiáveis**: armazenados e devolvidos como texto, nunca executados.
- Testes: `tests/documents.test.mjs`.

## [1.2.0] — Fase 2: preferências e isolamento
- Migração v2 (só tabelas novas): propriedade de recursos, configurações pessoais/globais, configurações antigas preservadas.
- Memórias, agentes, bots, execuções, aprovações e configurações isolados por administrador (rotas, ferramentas, agendador, Telegram).
- Dados antigos sem proprietário bloqueados; atribuição explícita, atômica e auditada; bots sem proprietário não executam (`legacy_blocked`).
- O agente padrão deixou de ser criado no banco; sem agente próprio usa-se um modelo embutido.

## [1.1.2] — 2026-10-14
### Segurança
- Curinga `*` vinculado a sessão de administrador verificada e viva (registro privado em `server/auth.js`); objetos forjados são negados.
- `createServiceToken()` exige sessão verificada e rejeita `*`, escopos de administrador, desconhecidos e listas inválidas com códigos específicos.
- Rotas `session` usam `isVerifiedAdmin()`.
### Testes
- Novos testes de identidade forjada, revogação/expiração/desativação e emissão de tokens; fixtures de admin sintético substituídos por login real.

## [1.1.1] — 2026-10-14
### Adicionado
- Autenticação de administradores (máx. 2) no serviço local: sessão em cookie HttpOnly/SameSite=Strict, expiração por inatividade (30 min) e absoluta (12 h), rotação no login, revogação no servidor.
- Proteção CSRF em toda operação que altera estado (inclusive logout).
- Primeiro acesso com código de uso único (15 min) gravado em `data/bootstrap-token.txt` (permissão 0600), consumido atomicamente.
- Limite progressivo de tentativas de login por origem+conta, origem e conta, com resposta genérica.
- Tokens de serviço com escopos e revogação para MCP e scripts; autorização reaplicada em cada ferramenta.
- Identidade responsável por execução de bots; novos bots registram proprietário; bots antigos não são reatribuídos.
- Migrações versionadas com backup verificado em `data/backups/` e reversão total em caso de falha.
- Aba Segurança no painel (administradores, sessões, tokens) e telas de entrada/primeiro acesso.
### Alterado
- `/api/health` passa a expor só `ok`, `version`, `setupRequired`.
- `cli_agent` em modo de confirmação exige aprovação no painel.
- O MCP exige `JARVIS_SERVICE_TOKEN`.

## [1.1.0] — 2026-10-14
### Adicionado
- **Novas ferramentas de agente** (`server/tools.js`):
  - `context7_docs` — busca documentação atualizada de bibliotecas no **Context7** (MCP sobre HTTP).
  - `crawl_page` — extrai markdown limpo de páginas (inclusive JS) via **crawl4ai**.
  - `openhands_task` — delega tarefas de código ao agente autônomo **OpenHands**.
- **Provedor `headroom`** (proxy OpenAI-compatível local com compactação de contexto) em `server/llm.js`
  e no catálogo do painel.
- **Acesso pela rede privada Tailscale**: `scripts/tailnet-proxy.mjs` expõe API e painel no IP do
  tailnet sem abrir na LAN e sem exigir `sudo`. O painel passa a detectar o endereço do serviço pelo
  hostname da página (`src/lib/bridge.ts`), funcionando igual em `localhost` e no tailnet.
- **Origens confiáveis dinâmicas**: `scripts/start-local.sh` adiciona automaticamente o IP Tailscale e
  o nome MagicDNS a `JARVIS_ALLOWED_ORIGINS`.
- **Integrações no catálogo do painel** (`src/lib/catalog.ts`): Context7 (MCP), OpenHands, Headroom e crawl4ai.

### Corrigido
- `server/db.js`: ativa **WAL** e `busy_timeout` no SQLite, evitando `database is locked` em acessos
  concorrentes (scripts/CLI lendo o banco enquanto o serviço roda).
- `server/bots.js`: o agendador agora captura exceções — uma falha de tick não derruba mais o serviço.
- `scripts/start-local.sh`: encerra quando qualquer componente morre, para o systemd (`Restart=always`)
  reiniciar o conjunto em vez de ficar com o serviço parcialmente no ar.

### Documentação
- `INTEGRACOES-LAYTECH.md`: instalação, portas, integrações, Tailscale, substituição do OpenJarvis e rollback.
- `docs/CONFIGURACAO.md`, `docs/ARQUITETURA.md`, `docs/IMPLANTACAO.md` e `docs/VALIDACAO.md` atualizados
  com as novas ferramentas, integrações e o acesso por Tailscale.

## [1.0.2] — 2026-10-13
### Corrigido
- `server/llm.js`: `callOpenAI` passa a enviar `stream: false`. Gateways compatíveis com OpenAI
  (Omniroute, entre outros) respondem em `text/event-stream` por padrão, e o `r.json()` quebrava
  com `Unexpected token 'd', "data: {...` — a conversa falhava mesmo com o provedor OK.

### Documentação
- Primeiro uso: trocar o provedor/modelo **do agente** é passo obrigatório (ligar um provedor em
  Configurações não troca o do agente, que nasce no Ollama), e o painel deve ser aberto por
  `localhost`, não pelo IP da máquina.
- Solução de problemas: `ECONNREFUSED` em `11434` com outro provedor ligado, resposta SSE,
  “Modo demonstração” por origem não confiável, microfone `not-allowed`/`abort`/`network` por
  falta de contexto seguro, campo de API Key vazio após salvar (mascaramento esperado) e a porta
  7777 não servir páginas.

## [1.0.1] — 2026-10-13
### Segurança
- `nodemailer` atualizado de `^6.9.16` para `^10.1.0`, zerando um alerta de severidade alta que
  agrupava 15 advisories: injeção de comando SMTP via CRLF (nome do transporte, `envelope.size`,
  cabeçalhos `List-*`), entrega a domínio não pretendido por erro de interpretação e por bypass de
  IDN/punycode, leitura arbitrária de arquivo e SSRF pela opção `raw` e por `resolveContent()`,
  vazamento de credencial SMTP entre transportes pelo cache global de DNS, e vários DoS no
  `addressparser`. A v10 pede Node >=20, abaixo do mínimo do projeto (22.13), e o uso em
  `server/comms.js` (`createTransport` + `sendMail`) não mudou de contrato.

### Corrigido
- `scripts/instalar-voz.cmd` e `instalar-voz.sh`: a seleção do Python procurava só pelo launcher
  (`where py`) e, quando nenhum 3.10–3.12 estava instalado, caía no `python` do PATH — em geral
  3.13/3.14, onde o `kokoro` (`requires_python <3.13`) não instala. A `.venv` era criada e o
  `pip install` falhava no fim. Agora procuram 3.11, 3.12 e 3.10 explicitamente, abortam com
  mensagem clara se não acharem e propagam erro em cada etapa.

### Documentação
- Faixa de Python da voz corrigida de 3.10–3.11 para **3.10–3.12** (o limite vem do `kokoro`).
- Instalação: comandos de verificação por etapa (`npx vitest run`, `/api/health`), nota de que o
  `npm install` fica silencioso, recomendação de caminho de instalação e nota sobre Pythons do uv.
- Validação: resultado real em Windows 11 com Node 24 (7/7 e 6/6) e a exposição de rede do painel
  em modo `dev`.
- Implantação: exemplo completo de NSSM e de atalho em `shell:startup`; URLs apontando para este
  repositório.

## [1.0.0] — 2026-10-13
### Adicionado
- Painel web com conversa, avatar 3D, memória, agentes, bots e configurações (PT/EN/ES).
- Serviço local Node.js (`server/`) com SQLite embutido e chaves cifradas.
- Provedores: Ollama, Anthropic, OpenAI, HuggingFace, Omniroute, OpenCode Go, OpenRouter, Groq, Gemini, OpenWebUI, compatível com OpenAI.
- Integrações: Claude Code, Codex, OpenCode, Hermes, OpenClaw, Odysseus, OpenWebUI, servidor MCP para Claude Desktop.
- Voz: navegador, Kokoro local, XTTS-v2 com voz clonada, ElevenLabs.
- Ativação por palmas duplas, nome do agente, atalho e apertar para falar.
- Bots autônomos com agenda, intervalo, arquivo, mensagem e frase de voz.
- Gmail/Outlook (IMAP/SMTP), agenda ICS, Telegram, WhatsApp, Signal.
- Scripts de instalação para Windows e Linux; CI em Ubuntu e Windows.

## - 2026-10-14

### ✨ Adicionado
- **Interface Web Imersiva:** Painel construído com React, TanStack e Tailwind CSS rodando por padrão em `http://localhost:8080`.
- **Núcleo Holográfico 3D:** Renderização de avatar interativo utilizando Three.js que reage visualmente aos estados de áudio (escutando, pensando, falando).
- **Mecanismos de Ativação Multi-Modais:** Suporte para ativação via palmas duplas (calibráveis), palavra de ativação (*Wake Word* "Jarvis"), atalho de teclado `Ctrl+Shift+J` e *Push-to-Talk*.
- **Clonagem de Voz Local/Nuvem:** Integração nativa com XTTS-v2 (local via Python) e ElevenLabs (nuvem).
- **Ecossistema de IA Híbrido:** Suporte extensível para Ollama (100% offline), Anthropic, OpenAI, Gemini, Groq, OpenRouter e qualquer provedor compatível com a API da OpenAI.
- **Protocolo MCP:** Integração de agentes externos via Claude Desktop (Model Context Protocol).
- **Memória Semântica:** Armazenamento de fatos e notas utilizando busca vetorial local baseada em embeddings (Ollama ou OpenAI).
- **Canais de Comunicação:** Módulos de integração integrados para Gmail, Outlook (IMAP/SMTP), arquivos de agenda (.ics), Telegram, WhatsApp Cloud API e Signal.

### ⚙️ Modificado
- **Arquitetura de Banco de Dados:** Migração para o motor SQLite embutido do Node.js 22+, eliminando a necessidade de compilação nativa no host e simplificando o processo de instalação.

### 🔒 Segurança
- **Isolamento de Rede:** Restrição rígida de escuta do serviço local apenas para a interface de loopback (`127.0.0.1`), recusando origens externas por padrão.
- **Criptografia de Dados:** Implementação de algoritmo AES-256-GCM para cifragem de chaves e dados sensíveis persistidos no diretório `data/`.
- **Ações do Host Protegidas:** Sistema de execução de comandos locais vem desligado por padrão, operando sob uma lista de permissões estrita (*whitelist*) e registro em log de auditoria.

---

*Nota: Os lançamentos anteriores a este marco estão consolidados na árvore de commits do Git.*


# 📝 Changelog

Todas as mudanças notáveis neste projeto serão documentadas neste arquivo. O formato é baseado no [Keep a Changelog](https://keepachangelog.com) e este projeto adere ao [Semantic Versioning](https://semver.org).

---


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


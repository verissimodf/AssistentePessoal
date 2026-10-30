# Milestone v1.10.0 — Project Summary

**Gerado:** 2026-10-30
**Propósito:** Onboarding de novos colaboradores e revisão de projeto
**Janela do marco:** `v1.7.9` (26/10/2026) → `1.10.0` (30/10/2026)
**Nota de adaptação:** Este repositório não usa a estrutura `.planning/` do GSD. O resumo foi
montado a partir dos artefatos equivalentes do projeto: `CHANGELOG.md`, `roadmap.md`,
`docs/ARQUITETURA.md`, `README.md` e estatísticas do Git.

---

## 1. Visão geral do projeto

AssistentePessoal é um assistente pessoal inspirado no J.A.R.V.I.S. de *Iron Man*, que roda inteiro
na máquina do operador: API Node 22 sobre SQLite (`node:sqlite`, sem dependências nativas), painel
React/TanStack e nenhuma dependência de nuvem própria. Toda ação externa do agente passa por
aprovação humana (gate D9) e todo recurso de banco é filtrado por ownership explícito.

Neste marco (5 dias), o projeto saiu da 1.7.9 para a 1.10.0 em sete releases, cada uma implantada
em produção com migração de schema ensaiada, backup verificado e suíte completa verde. As três
frentes entregues foram: **integração de e-mail server-side** (AgentMail com webhook assinado),
**fila durável e capacidades locais** (jobs idempotentes, OAuth Gmail/Graph, STT whisper.cpp,
navegador isolado com Playwright) e **experiência de chat** (streaming NDJSON, citações pontuais,
JEV Reflex advisory e atualização assistida por tag).

## 2. Arquitetura e decisões técnicas

A topologia é de processo único em container: um container `assistente-pessoal` serve API (7777)
e painel (8090) atrás de nginx + túnel Cloudflare, sem portas publicadas no host. O estado vive em
`/app/data` (SQLite WAL + `master.key` + voz + documentos + backups). Componentes opcionais
(`xtts-service`, worker de navegador, STT) rodam como perfis Docker isolados — o entrypoint
encerra o conjunto se um componente morrer.

Decisões com racional documentado (fonte: `roadmap.md`, `CHANGELOG.md`, `docs/ARQUITETURA.md`):

- **SQLite em vez de fila externa (Redis):** a fila durável de jobs é uma tabela SQLite com payload
  cifrado, leases e recovery sem replay cego. Adotar Redis ou novo serviço de jobs exigiria
  evidência de que o scheduler atual não atende — ainda não há essa evidência. *Release 1.9.0.*
- **E-mail server-side com webhook assinado:** a integração AgentMail roda no servidor, não no
  cliente MCP. Verificação Svix com `node:crypto` (HMAC-SHA256, janela de 5 min, comparação em
  tempo constante), dedupe por `svix-id` e persistência de **apenas metadados** — o corpo do
  e-mail só é lido sob demanda, com escopo `comms:read`. *Release 1.8.0.*
- **Navegador isolado em worker sem rede:** worker Playwright dedicado, UID/GID próprio, conecta
  ao broker por socket Unix; egress por proxy com DNS pinado, allowlist de destinos e grants curtos
  emitidos pelo app. Endpoint HTTP legado falha fechado. Capacidade entregue **desligada por
  padrão**. *Release 1.9.3.*
- **Revalidação de escopo no momento da execução:** a rota valida sessão/CSRF/escopo, mas
  `callTool` revalida o escopo da ferramenta quando o modelo a invoca — caminhos indiretos
  (webhook, bot, Telegram) não contornam o gate. Envio de e-mail é sempre D9 (aprovação humana).
- **Streaming como adição, não substituição:** o `/api/chat/stream` (NDJSON) convive com o
  `/api/chat` intocado como fallback; citações guardam snapshot da fonte no instante da resposta,
  sobrevivendo a edições/exclusões posteriores do documento. *Release 1.10.0.*
- **JEV Reflex é advisory por design:** classificador pré-resposta opt-in que registra métricas em
  `meta.reflex` e nunca gatilha, bloqueia ou autoriza nada; em falha do roteador o chat segue
  normal. Canais externos não passam pelo Reflex. *Release 1.10.0.*

## 3. Releases entregues no marco

| Release | Data | Tema | Destaque |
|---------|------|------|----------|
| 1.8.0 | 26/10 | Integração AgentMail server-side | Webhook Svix verificado, envio D9 com evidência `verified(provider_message_id)`, migração v13 |
| 1.8.1 | 27/10 | Isolamento e correções | Ownership explícito de inboxes (v14), invalidação de aprovações quando a inbox muda |
| 1.8.2 | 27/10 | Qualidade do núcleo | Avaliação offline versionada (`npm run eval:agents`), hardening do scheduler, migração v15 |
| 1.9.0 | 27/10 | Capacidades locais | Fila SQLite durável (v16), retenção de memória opt-in (v17), OAuth Gmail/Graph PKCE (v18), STT whisper.cpp |
| 1.9.1 | 27/10 | Voz e higiene | Ponte TTS com voz pré-cadastrada do `xtts-service`, 88 arquivos formatados |
| 1.9.3 | 28/10 | Navegador isolado | Worker Playwright sem rede, broker egress com DNS pinado, migração v19 |
| 1.10.0 | 30/10 | Chat em tempo real | Streaming NDJSON, citações pontuais, JEV Reflex advisory, `npm run update:release` |

## 4. Cobertura de requisitos (estado do roadmap)

- ✅ **Avaliação offline dos fluxos agênticos** — determinística, sem rede/chaves, no CI.
- ✅ **Hardening do scheduler (dedupe/concorrência)** — limite por admin/bot, ledger SQLite, replay pós-restart bloqueado.
- ✅ **Política de conectores de e-mail** — IMAP/SMTP avançado + AgentMail server-side; envio sob D9.
- ⚠️ **Observabilidade do router** — contagens/latência/fallback/tokens expostos, mas voláteis; falta retenção configurável com expurgo.
- ⚠️ **Retomada do scheduler** — interrupção vira `interrupted` sem replay; idempotência por ferramenta ainda não implementada.
- ⚠️ **Portão de release** — CI + smoke descartável prontos; falta ensaio automatizado de rollback.
- ⚠️ **Ciclo de vida de memória / RAG / conhecimento opt-in** — entregues parcialmente; retenção automática segue desativada até haver política explícita.
- ❌ **CRUD de tarefas e OAuth de calendário** — decidido manter ICS read-only até haver requisito de produto.
- ❌ **STT local em produção** — container homologado não inclui motor de fala; capacidade existe como perfil isolado.

## 5. Log de decisões-chave

| Decisão | Data | Racional |
|---------|------|----------|
| Sem Redis/serviço de jobs externo | 2026-10-27 | Falta evidência de que o scheduler atual exija infraestrutura externa |
| Sem OAuth de terceiros (calendário) | 2026-10-27 | ICS read-only + IMAP/SMTP/AgentMail cobrem os fluxos disponíveis |
| Sem STT local ativo na homologação | 2026-10-27 | Container homologado não inclui motor de fala |
| Sem retenção automática de memória | 2026-10-27 | Primeiro: período por admin, preview e confirmação antes de remover dados |
| Sem CRUD genérico de agentes/bots | 2026-10-23 | Requer decisão de produto sobre identidade, agendamento e aprovação |
| Rascunhos de e-mail transitórios | 2026-10-23 | Envio por agente exige aprovação humana D9 |
| Skills offline/idempotentes por padrão | 2026-10-23 | Modo de rede `full` é opt-in explícito |

## 6. Dívida técnica e itens adiados

- **Lint:** 407 ocorrências Prettier e 8 violações `no-explicit-any` no baseline da 1.8.2; política
  é reduzir em lotes pequenos, nunca reformatar tudo junto de mudanças funcionais. (88 arquivos já
  formatados na 1.9.1.)
- **Caminho independente do MCP hospedado:** clientes diretos do AgentMail em `.mcp.json`/
  `opencode.json` não herdam ownership, aprovação D9 nem auditoria do Jarvis — decisão de
  remoção/desabilitação pendente.
- **Telemetria em memória do processo** — sem retenção configurável persistente.
- **Idempotência de efeitos por ferramenta** — pré-requisito para retomada automática de jobs.
- **Métrica offline de precisão/recall do RAG** — o painel mostra trecho, modo, relevância e
  motivo de fallback, mas falta comparável objetivo de qualidade.

## 7. Como começar

- **Rodar em desenvolvimento:** `npm run dev` (Vite 8080 → API em 127.0.0.1:7777 → SQLite em `./data`).
- **Testes:** `npm test` (Vitest — 688 testes backend / 109 frontend na 1.10.0); `npm run eval:agents` para os cenários agênticos offline.
- **Build:** `npm run build` (Vite + Nitro); produção via `docker-compose.yml` com `Dockerfile`.
- **Instalação completa:** `docs/INSTALACAO.md`; atualização assistida: `npm run update:release`.
- **Documentos essenciais:** `docs/ARQUITETURA.md` (topologia, componentes, fluxos, limites de confiança), `roadmap.md` (priorização e decisões), `docs/CONFIGURACAO.md`, `CONTRIBUTING.md` (política de desenvolvimento por risco).
- **Comece por estes arquivos:** `server/index.js` (rotas e authz em um único ponto), `server/auth.js` (regras puras, testável com clock injetado), `server/migrations.js` (única via para mudar schema), `AGENTS.md` (regras invariantes do projeto).

---

## Estatísticas

- **Linha do tempo:** 26/10/2026 → 30/10/2026 (5 dias)
- **Releases:** 7 (1.8.0 → 1.10.0); 5 migrações de schema (v13 → v19), todas com backup verificado
- **Commits:** 276 desde `v1.7.9`
- **Arquivos alterados:** 209 (+22.132 / −3.371)
- **Validação na 1.10.0:** backend 688/688, frontend 109/109, TypeScript, build e smoke do container aprovados
- **Contribuidores:** verissimodf, laytech.ia@gmail.com

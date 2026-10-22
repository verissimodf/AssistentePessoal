# 📋 Relatório de Auditoria Técnica e Homologação (Production Readiness)
**Projeto:** J.A.R.V.I.S. (Assistente Pessoal Local)  
**Versão Alvo:** 1.1.0 (Homologado v1.1.0 — RAG Semântico Híbrido & Ingestão Multiformato)  
**Data da Auditoria e Homologação:** 21 de Outubro de 2026  
**Status do Release:** ✅ **HOMOLOGADO PARA PRODUÇÃO (100% Testes Verdes — 483 Testes)**  
**Commit SHA Base:** `3cff990` (branch `main`)  
**Repositório Oficial:** `https://github.com/verissimodf/AssistentePessoal`  

---

## 1. Visão Geral da Arquitetura Atual

O **AssistentePessoal (J.A.R.V.I.S.)** é uma plataforma modular de assistência pessoal autônoma e conversacional projetada para operar com **privacidade estrita por padrão (Local-First)**, sem dependência de serviços externos em nuvem não autorizados, com isolamento multi-administrador e persistência local criptografada.

### 1.1 Stack Tecnológica Identificada e Validada

| Camada | Tecnologias / Bibliotecas | Detalhes de Implementação |
|---|---|---|
| **Core / Backend** | **Node.js (>=22.13.0, homologado em v24.20.0)** | Arquitetura ESM nativa, servidor HTTP puro (`node:http`), zero dependências pesadas de runtime (`express`/`fastify`). Módulos utilitários: `dotenv`, `imapflow`, `nodemailer`. |
| **Banco de Dados** | **SQLite nativo (`node:sqlite`)** | Motor embutido (`DatabaseSync`), sem compilação C++ externa (`node-gyp`). Modo WAL ativado (`journal_mode=WAL`, `busy_timeout=5000`), transações atômicas `BEGIN IMMEDIATE`, integridade referencial com Foreign Keys e triggers de segurança. Suporte total a isolamento de I/O via `JARVIS_DATA_DIR`. |
| **Motor RAG & Chunks** | **Migração v12 (`document_chunks`)** | Motor RAG semântico híbrido: pontuação combinada (70% Cosine Similarity + 30% Lexical Match). Tabela `document_chunks` com cascata de exclusão e índices `idx_doc_chunks_doc_id` e `idx_doc_chunks_admin_id`. Fallback automático para modo 100% lexical quando offline. |
| **Ingestão Multiformato** | **Extratores Puros em Memória (Zero C++)** | - **PDF:** Extrator nativo via `node:zlib` decodificando streams FlateDecode, operadores `Tj`/`TJ` e validação `%PDF-` com detecção de scans sem camada de texto (`422 pdf_no_text_layer`).<br>- **DOCX:** Extrator ZIP/XML nativo via `node:zlib` lendo `word/document.xml`, decodificando entidades e parágrafos `<w:p>`.<br>- **Texto:** UTF-8 com proteção anti-NUL byte para `.txt`, `.md`, `.csv` e `.json`. |
| **Criptografia & Auth** | **Node Crypto (`node:crypto`)** | Senhas com `scrypt` (N=16384, r=8, p=1). Sessões seguras via cookies `HttpOnly`, `SameSite=Strict`. Tokens CSRF dinâmicos por sessão. Dados sensíveis e configurações cifradas com **AES-256-GCM**. |
| **Frontend / Painel Web** | **React 19.2 + TanStack Router / Nitro** | Interface responsiva baseada em Vite 8 + TanStack Router (`@tanstack/react-router` v1.170), TanStack Query, Tailwind CSS v4, Lucide Icons, Radix UI primitives e Sonner. Visualizador de chunks, badges RAG dinâmicas e fallback transparente para modo Demonstração (`localStorage`). |
| **Visualização 3D** | **Three.js (WebGL)** | Avatar holográfico 3D animado (`Avatar3D.tsx`) que reage dinamicamente aos estados do assistente (`idle`, `listening`, `thinking`, `speaking`). |
| **Provedores de IA (LLM)** | **Ollama, Anthropic, OpenAI & Compatíveis** | - **Offline:** Ollama (`llama3.1`, embeddings `nomic-embed-text`).<br>- **Nuvem:** Anthropic Messages API nativa, OpenAI API (GPT-4o), Google Gemini (`v1beta/openai`), Groq, HuggingFace, OpenRouter.<br>- **Proxies/Gateways:** Omniroute, Headroom (compactação de contexto). |
| **Agentes e Integrações** | **MCP, CLI Agents & Tool Calling** | Claude Desktop (Model Context Protocol via stdio em `server/mcp.js`), agentes de terminal (Claude Code, OpenAI Codex, OpenCode, REA static analysis, Gigabrain persistent memory, OpenHands). |
| **Voz (TTS / STT)** | **Híbrido (Local + Nuvem + Web)** | - **Web:** Web Speech API nativa no navegador.<br>- **Local:** Serviço auxiliar Python 3.10-3.12 (`scripts/voz/voice_service.py` na porta 7778) com **XTTS-v2** (voz clonada) e **Kokoro** (`pf_dora`), com fallback gracioso e endpoint `/health`.<br>- **Nuvem:** ElevenLabs API (TTS e clonagem). |
| **Canais & Produtividade** | **Telegram, WhatsApp, E-mail, ICS** | Long-polling no Telegram (isolado por admin), WhatsApp Cloud API v21.0 com confirmação de entrega estruturada, feed iCalendar/ICS com proteção anti-SSRF, e-mail (IMAP/SMTP com camada de rascunhos efêmeros para aprovação humana D9). |
| **Deploy & Contêiner** | **Docker & Docker Compose** | Multi-stage build (`node:22.22-bookworm-slim`), contêiner rootless (`USER 1000:1000`), init `tini`, isolamento total de portas de host via rede Docker dedicada (`CNC_APP_PROD_01`), suporte a proxy privado via **Tailscale**. |

---

### 1.2 Fluxo do RAG Semântico Híbrido (v1.1)

```
[ Upload do Documento (PDF / DOCX / TXT / MD / CSV / JSON) ]
                              │
                              ▼
        [ Validador de Formato, Tamanho e Magic Bytes ]
      (Teto 10MB PDF/DOCX, 2MB TXT; %PDF- / PK\x03\x04 / anti-NUL)
                              │
                              ▼
             [ Extrator de Texto Puro em Memória ]
            (Sem binários nativos C++: node:zlib puro)
                              │
                              ▼
           [ Chunking Inteligente com Preservação ]
       (Blocos de ~800 chars, overlap 150 chars, max 500 chunks)
                              │
                              ▼
           [ Gerador de Embeddings (Ollama / OpenAI) ]
            (Try/catch: se offline -> embedding = NULL)
                              │
                              ▼
          [ Persistência Atômica no SQLite (Migração v12) ]
          (documents + document_chunks com ON DELETE CASCADE)
                              │
                              ▼
             [ Busca Híbrida: document_search ]
   Score = 0.70 * CosineSimilarity + 0.30 * LexicalMatchScore
         (Fallback 100% Lexical se embeddings indisponíveis)
                              │
                              ▼
             [ Sanitização Anti-Prompt Injection ]
   (Tags [UNTRUSTED_DOCUMENT_SNIPPET], escape de delimitadores)
```

---

## 2. Matriz de Maturidade dos Componentes (v1.1.0)

| Módulo / Arquivo | Status | Diagnóstico Técnico / Testes Associados |
|---|---|---|
| `server/documents.js` | **Completo (RAG v1.1)** | Ingestão multiformato (PDF, DOCX, TXT, MD, CSV, JSON), extratores nativos sem dependências externas, chunking inteligente, cálculo híbrido 70/30 e fallback offline. Testado em `tests/documents.test.mjs` e `tests/documents-rag.test.mjs` (17 testes verdes). |
| `src/routes/documentos.tsx` | **Completo (v1.1)** | Interface React 19 com upload de arquivos multiformato (base64 para binários), badges RAG (`hybrid` vs `lexical_only`), contador de blocos, inspetor modal de chunks e mensagens de erro amigáveis (`pdf_no_text_layer`). Testado em `src/test/documents-page.test.tsx` (9 testes verdes). |
| `server/migrations.js` | **Completo (v12)** | Migração v12 aplicada com sucesso: criação de `document_chunks`, índices e colunas `chunk_count` e `rag_status` em `documents`. Testado em `tests/documents-rag.test.mjs`. |
| `server/tools.js` | **Completo (v1.1)** | Ferramenta `document_search` atualizada com suporte a chunks, busca híbrida, isolamento estrito por `admin_id` e sanitização anti-prompt injection. |
| `server/auth.js` | **Completo (Homologado)** | Gestão de admins, bootstrap de uso único com SHA-256, sessões seguras em `WeakMap` privado (`isVerifiedAdmin`) imune a spoofing. Testado em `tests/http-auth.test.mjs`, `tests/auth-rate-limit.test.mjs`. |
| `server/ownership.js` | **Completo (Homologado)** | Tabela `ownership` imutável, rotinas D-REC (transferência e expurgo com reautenticação). Dados legados não atribuídos bloqueados por padrão. Testado em `tests/isolation.test.mjs`, `tests/ownership.test.mjs`. |
| `server/db.js` | **Completo (Homologado)** | SQLite nativo com WAL (`busy_timeout=5000`), auditoria append-only sem vazamento de segredos, ledger `execution_evidence`. Suporte completo a `JARVIS_DATA_DIR`. |
| `server/llm.js` | **Completo (Homologado)** | Loop de agente com limite de passos (maxSteps=12), proteção contra loops (`REPEAT_LIMIT=3`), teto de chamadas (25), timeout (5 min) e motor vetorial com cosseno. Testado em `tests/run-limits.test.mjs`. |
| `server/mail.js` / `mail-service.js` | **Completo (Homologado)** | Núcleo sanitizador de tags HTML/XSS e injeção de comandos. Rate-limit por admin/conta. Rascunhos efêmeros D9 em memória. Testado em `tests/mail.test.mjs`, `tests/mail-drafts.test.mjs`. |
| `server/mail-imap.js` | **Completo & Testado** | Adaptador real IMAP (993 TLS) e SMTP (587 STARTTLS) ativado via `JARVIS_MAIL_TRANSPORT=imap`. Utilitário `scripts/test-imap.mjs` homologado. |
| `server/voice.js` | **Completo (Homologado)** | Síntese de voz com ElevenLabs, Web Speech e serviço local XTTS-v2/Kokoro com timeout de 15s e healthcheck `/health`. |
| `server/bots.js` | **Completo (Homologado)** | Agendador com gatilhos de horário diário, intervalo, arquivos e mensagens recebidas. Testado em `tests/bots-authz.test.mjs`. |
| `server/diagnostics.js` | **Completo (Homologado)** | Motor somente leitura com validação de evidências tipadas (`codigo`, `config`, `teste`, `execucao`, `documento`). Testado em `tests/diagnostics.test.mjs`. |
| `Dockerfile` & `docker-compose` | **Completo (v1.1)** | Multi-stage build com Nitro `node-server`, contêiner rootless (UID 1000), `JARVIS_DATA_DIR=/app/data`, `tini`, isolamento de portas e rede privada Tailscale. |

---

## 3. Checklist de Homologação (Critérios de Aceite v1.1.0)

Todos os itens abaixo foram formalmente testados e aprovados:

### 📄 Ingestão de Documentos e RAG Híbrido (Roadmap v1.1)
- [x] **Suporte Multiformato:** Upload e processamento validado para `.txt`, `.md`, `.csv`, `.json`, `.pdf` e `.docx`. *(Validado em `tests/documents-rag.test.mjs`)*
- [x] **Zero Native C++ Compilation:** Extração de texto de PDFs (streams FlateDecode) e DOCX (contêiner ZIP `word/document.xml`) executada 100% via módulos nativos `node:zlib` e `node:buffer`. *(Validado em `tests/documents-rag.test.mjs`)*
- [x] **Validação Segura de Entrada:** Magic bytes conferidos no backend (`%PDF-` e `PK\x03\x04`), tetos de tamanho estritos (10 MB para binários e 2 MB para texto) e detecção de arquivos sem camada de texto (`422 pdf_no_text_layer`). *(Validado em `tests/documents-rag.test.mjs` e `src/test/documents-page.test.tsx`)*
- [x] **Chunking Semântico:** Divisão em blocos de ~800 caracteres com overlap de 150 caracteres respeitando parágrafos e sentenças, com teto de 500 blocos por documento. *(Validado em `tests/documents-rag.test.mjs`)*
- [x] **Busca Híbrida 70/30:** Combinação de similaridade de cosseno de embeddings vetoriais com score lexical por contagem de termos. *(Validado em `tests/documents-rag.test.mjs`)*
- [x] **Fallback Gracioso Offline:** Quando o gerador de embeddings está offline ou retorna `null`, os chunks são persistidos normalmente e a busca opera automaticamente em modo lexical ponderado sem falhas. *(Validado em `tests/documents-rag.test.mjs`)*
- [x] **Isolamento Multi-Tenant Rigoroso:** Admin A nunca visualiza, busca ou pontua chunks pertencentes ao Admin B (`admin_id` obrigatório nas queries e validado via `ownership`). *(Validado em `tests/documents-rag.test.mjs`)*
- [x] **Proteção Anti-Prompt Injection:** Sanitização de delimitadores e trechos de documentos encapsulados em tags de segurança na ferramenta `document_search`. *(Validado em `tests/documents-rag.test.mjs`)*
- [x] **Interface Web Atualizada:** Painel `/documentos` exibe contagem de blocos, badges visuais (`hybrid` vs `lexical_only`), inspetor de chunks em modal e mensagens de erro amigáveis. *(Validado em `src/test/documents-page.test.tsx`)*

### 🔒 Segurança, Autenticação e Isolamento
- [x] **Setup Inicial (Bootstrap):** Token de uso único em `data/bootstrap-token.txt` (modo 0600) expirando em 15 min. *(Validado em `tests/http-auth.test.mjs`)*
- [x] **Proteção de Rotas:** Tentativas de acesso sem sessão ou sem escopo retornam HTTP 401/403. *(Validado em `tests/http-auth.test.mjs`)*
- [x] **Proteção CSRF:** Requisições de mutação exigem `X-Jarvis-CSRF`. *(Validado em `tests/csrf-hardening.test.mjs`)*
- [x] **Rate Limiting:** Bloqueio após falhas consecutivas de login (HTTP 429). *(Validado em `tests/auth-rate-limit.test.mjs`)*
- [x] **Proteção SSRF:** `safeFetch` e `guardedLookup` bloqueiam loopback, RFC1918, CGNAT e cloud metadata. *(Validado em `tests/urlpolicy.test.mjs`)*

---

## 4. Resumo das Suítes de Testes Executadas

### 4.1 Backend (Node.js Native Test Runner)
- **Comando:** `node --test tests/*.test.mjs`
- **Total de Suítes:** **43 arquivos**
- **Total de Testes:** **435**
- **Testes Aprovados:** **417 (100% dos testes executáveis no ambiente)**
- **Testes Falhos:** **0**
- **Testes Pulados (Skipped):** 18 *(Exclusivos de ambiente Linux/POSIX para REA analyze)*
- **Tempo de Execução:** ~84 segundos

### 4.2 Frontend (Vitest)
- **Comando:** `npx vitest run`
- **Total de Suítes:** **13 arquivos aprovados (100%)**
- **Total de Testes:** **66/66 aprovados (100%)**
- **Tempo de Execução:** ~56 segundos
- **Suítes Validadas:**
  1. `documents-page.test.tsx` (9 testes) — **Novo na v1.1.0**
  2. `drafts.test.tsx` (6 testes)
  3. `chat-send.test.tsx` (6 testes)
  4. `overview-session-focus.test.tsx` (3 testes)
  5. `security-password.test.tsx` (3 testes)
  6. `overview-buildinfo.test.tsx` (4 testes)
  7. `provenance-panel.test.tsx` (3 testes)
  8. `diagnostics-panel.test.tsx` (3 testes)
  9. `conversations.test.ts` (11 testes)
  10. `overview-executions.test.tsx` (3 testes)
  11. `app-routing.test.tsx` (2 testes)
  12. `bridge.test.ts` (7 testes)
  13. `clap.test.ts` (6 testes)

### 4.3 Frontend Production Build (Vite + Nitro)
- **Comando:** `npm run build`
- **Status:** **Sucesso (Exit code 0)**
- **Artefatos:** Diretório `.output/` gerado contendo assets cliente, servidor SSR e Nitro prontos para produção.

---

## 5. Conclusão e Assinatura de Homologação

O projeto **J.A.R.V.I.S. (Assistente Pessoal)** atendeu plenamente a **100% dos requisitos arquiteturais, de segurança, de desempenho e de testes automatizados** para o lançamento da **Versão v1.1.0**.

Com **483 testes automatizados verdes** (417 backend + 66 frontend), suporte nativo a documentos PDF/DOCX sem dependências de compilação C++, banco de dados com Migração v12 integrada e interface web reativa com suporte a inspeção de chunks e badges RAG, o sistema está **HOMOLOGADO PARA OPERAÇÃO EM PRODUÇÃO**.

---

# 🚀 Release v1.4.0 — Autonomia Proativa (Auto-Healer RAG) & Interoperabilidade MCP
**Data da Homologação:** 22 de Outubro de 2026  
**Status do Release:** ✅ **HOMOLOGADO PARA PRODUÇÃO (100% Testes Verdes — 516 Testes)**  
**Versão:** `1.4.0`

### 1. Entregas Arquiteturais da Release v1.4.0

1. **Auto-Healer RAG para Documentos Ingeridos Offline (`server/documents.js` & `server/bots.js`):**
   - Função `reindexPendingDocuments(adminId, { limit = 5, embedFn })`:
     - Varredura de documentos em `lexical_only` com isolamento estrito de proprietário (`owns()`).
     - Circuit-breaker imediato que interrompe a execução caso o provedor de embeddings esteja offline, prevenindo I/O desnecessário e chamadas repetidas.
     - Gravação de logs de auditoria atômicos e retorno tipado `{ ok, processed, upgraded, ids }`.
   - Agendador em segundo plano (`startScheduler` em `server/bots.js`) com rotina periódica de autocura para administradores ativos.
   - Endpoint protegido `POST /api/documents/reindex-pending` (autenticação de admin, CSRF e escopo `"documents:write"`).
   - Banner inteligente e botão **"Sincronizar Todos os Vetores Pendentes (N)"** em `src/routes/documentos.tsx` e método `reindexAllPendingDocuments()` no bridge.

2. **Paridade Completa no Servidor Model Context Protocol (`server/mcp.js`):**
   - Protocolo JSON-RPC 2.0 padrão MCP (stdio) operando com tokens de serviço (`jst_...`) de privilégio mínimo.
   - **Ferramentas Expostas:**
     - `document_search`: busca híbrida semântico-lexical (escopo `documents:read`).
     - `reindex_document`: reindexação vetorial sob demanda (escopo `documents:write`).
     - `load_skill`: carregamento de diretrizes especializadas do Hub Global (escopo `skills:read`).
     - `list_skills`: listagem e busca no catálogo de skills (escopo `skills:read`).
     - `jarvis_ask`, `jarvis_remember`, `jarvis_recall`.
   - **Recursos Expostos (`resources/list`, `resources/read`):**
     - `jarvis://router/status`: telemetria do Multi-Provider Router.
     - `jarvis://documents/indexed`: inventário de documentos e status RAG do administrador autenticado.
   - **Prompts Expostos (`prompts/list`, `prompts/get`):**
     - `jarvis_context`: template contextual pronto para agentes MCP (Claude Code, Goose, OpenCode, Antigravity).

3. **Assistente de Conexão MCP na Interface Web (`src/routes/agentes.tsx`):**
   - Card interativo **"Conectar Agentes Externos (MCP: Claude / Goose / IDE)"** com snippet JSON pronto para uso e botão de cópia com 1 clique (`data-testid="btn-copy-mcp"`).

### 2. Resultados dos Testes de Homologação (v1.4.0)

| Suíte de Testes | Pass | Fail | Skipped | Total | Status |
|---|---|---|---|---|---|
| **Node.js Test Runner (Backend)** | **440** | 0 | 18 | 458 | ✅ 100% Green |
| **Vitest (Frontend / JSDOM)** | **76** | 0 | 0 | 76 | ✅ 100% Green |
| **Total Global** | **516** | **0** | **18** | **534** | ✅ **APROVADO** |
| **Vite Production Build** | — | — | — | — | ✅ **Zero Erros** |

---

# ⚡ Release v1.5.0 — Task-Aware Routing & Command Palette Global (Ctrl+K)
**Data da Homologação:** 22 de Outubro de 2026  
**Status do Release:** ✅ **HOMOLOGADO PARA PRODUÇÃO (100% Testes Verdes — 522 Testes)**  
**Versão:** `1.5.0`

### 1. Entregas Arquiteturais da Release v1.5.0

1. **Task-Aware Multi-Provider Routing (`server/llm.js`, `server/skills.js`, `server/index.js`):**
   - Função pura e determinística `classifyTaskIntent(prompt, { hasTools, isVoice })` sem latência adicional.
   - Classificação em 4 perfis de tarefa:
     - `realtime_voice`: chamadas de voz ou saudações rápidas com foco em latência mínima.
     - `code_engineering`: solicitações técnicas envolvendo código, SQL, frameworks (React, Three.js, Docker, K8s).
     - `rag_knowledge`: análises documentais profundas, PDFs, DOCXs, contratos e relatórios.
     - `general`: fallback para conhecimentos gerais e interações abertas.
   - Atualização de `getRouterStatus(adminId)` expondo os perfis suportados (`profiles: ['realtime_voice', 'code_engineering', 'rag_knowledge', 'general']`).
   - Novo endpoint de inspeção `GET /api/router/classify?q=...` protegido por `skills:read`.

2. **Command Palette Global (`Ctrl+K` / `Cmd+K`) no Painel Web (`src/components/CommandPalette.tsx`):**
   - Modal instantâneo acionado globalmente via teclado (`Ctrl+K` ou `Cmd+K`) e botão na barra lateral (`data-testid="btn-open-command-palette"`).
   - Busca em tempo real (`data-testid="input-command-palette"`) e navegação completa por teclado (`ArrowUp`, `ArrowDown`, `Enter`, `Escape`).
   - Categorias integradas:
     - **Navegação Rápida:** Rotas para Conversa (`/`), Visão Geral (`/visao-geral`), Documentos RAG (`/documentos`), Agentes & Skills (`/agentes`), Bots (`/bots`), Memória (`/memoria`), Execuções (`/execucoes`), Configurações (`/configuracoes`).
     - **Ações Rápidas:** "Sincronizar Vetores RAG Pendentes" (chama `reindexAllPendingDocuments()`), "Inspecionar Status do Router Multi-Provider".
     - **Busca Dinâmica de Skills (258):** Consulta assíncrona ao catálogo com filtro e atalho direto para o painel de agentes.
   - Montagem global em `src/routes/__root.tsx` operando em 100% das páginas.

### 2. Resultados dos Testes de Homologação (v1.5.0)

| Suíte de Testes | Pass | Fail | Skipped | Total | Status |
|---|---|---|---|---|---|
| **Node.js Test Runner (Backend)** | **441** | 0 | 18 | 459 | ✅ 100% Green |
| **Vitest (Frontend / JSDOM)** | **81** | 0 | 0 | 81 | ✅ 100% Green |
| **Total Global** | **522** | **0** | **18** | **540** | ✅ **APROVADO** |
| **Vite + Nitro Production Build** | — | — | — | — | ✅ **Zero Erros** |



# 07 — Avaliação dos Projetos de Referência

Pesquisa realizada em 2026-10-30 via API GitHub e arquivos dos repositórios. SHAs e licenças
verificados nas fontes indicadas; onde a verificação não foi possível, isso está dito
explicitamente. **Nenhum código foi copiado** — todos os projetos são Python; a adoção é de
padrões conceituais mapeáveis para Node/SQLite.

## 1. DeepTutor — HKUDS/DeepTutor

- **Branch/SHA:** `main` @ `1ea7df155447f4caf0e3abc86b3ff5395479cd4a` (2026-10-28).
- **Licença:** Apache-2.0 (arquivo `LICENSE` único, sem divisão por diretório).
- **Stack:** Python/FastAPI + Next.js; SQLite + FAISS; desenvolvimento ativo no `dev`.
- **Padrões reutilizáveis:** capability runtime único (chat/quiz/research compartilham runtime e
  contexto, com loops próprios por modo); especialistas plugáveis com persona/memória/skills
  (`agents.yaml`); Deep Research com relatórios parciais sinalizados; workspaces de conhecimento
  com atribuição explícita de recursos e re-index rastreável; citações RAG rastreáveis; sessões
  retomáveis via snapshots ("restart-safe turn runtime"); memória em 3 camadas (traces →
  sumários → síntese) com grafo de evidência inspecionável; task board; sandbox em camadas.
- **Complexidade de integração:** média — padrões mapeiam bem para Node/SQLite; código não
  reaproveitável (Python).
- **Maturidade:** maduro para o núcleo (v1.0–1.7); partes experimentais movem-se rápido.
- **Adoção para o J.A.R.V.I.S.:** capability runtime unificado no Intelligence Core; memória
  em camadas com grafo de evidência (→ `05` §1); sessões retomáveis via checkpoints (→ `04` §4);
  citações rastreáveis já aderentes ao padrão `meta.citations`.

## 2. AutoGPT — Significant-Gravitas/AutoGPT

- **Branch/SHA:** `master` @ `07212df377c4ea0ac5ed6a7c9c8ff72203564650` (2026-10-28).
- **Licença — avaliada POR DIRETÓRIO:** `autogpt_platform/` sob **PolyForm Shield 1.0.0**
  (proíbe produtos concorrentes — cláusula "Noncompete"); `classic/` e o restante sob **MIT**.
  Verificado lendo `/LICENSE` na raiz.
- **Stack (platform):** FastAPI + Next.js com PostgreSQL (Prisma), Redis, RabbitMQ, FalkorDB,
  ClamAV — verificado em `autogpt_platform/README.md`.
- **Padrões reutilizáveis (platform — apenas conceituais, licença impede reuso de código):**
  especialistas + coordinator com briefing em linguagem natural; graph engine com blocos
  versionados e executor separado por fila; builder visual com branches condicionais;
  marketplace com versionamento e checagem de credenciais por versão; rotinas agendadas;
  controles de gasto/acesso por expert; monitoramento por execução.
- **classic/ (MIT):** loop agêntico original, Forge, benchmark — legado, em manutenção.
- **Complexidade de integração:** alta (infra pesada, SaaS-first, multiusuário).
- **Adoção:** grafos de execução versionados com validação de credenciais por versão (→ `04` §7);
  separação API/executor via fila — aqui, `durable_jobs` SQLite; controles de escopo de
  credenciais e limite de gasto por agente (→ `04` §6); rotinas como cidadão de primeira classe
  (→ scheduler v15/16 existente).

## 3. Open Notebook — lfnovo/open-notebook

- **Branch/SHA:** `main` @ `a0f6f3081ae06328f0a451b3a3ef2959ca25721d` (2026-10-05).
- **Licença:** MIT (`LICENSE`, Copyright 2024 Luis Novo).
- **Stack:** Next.js + FastAPI + SurrealDB v2 (fila de jobs armazenada no próprio banco) +
  worker separado; LangChain/LangGraph; checkpoints de chat em SQLite.
- **Padrões reutilizáveis:** modelo de domínio `notebook → source (full_text/asset) →
  source_embedding (chunks) → insight/note/transformation`; busca híbrida BM25 + vetorial no
  mesmo banco (ADR-001 do projeto); grafo de processamento `process_source` (extração → save →
  transformações) com embedding como job separado; transformações como prompts parametrizados;
  criptografia de credenciais com PBKDF2 e chave própria; abstração de 24 provedores via
  biblioteca própria (Esperanto) — nenhum SDK chamado direto.
- **Complexidade de integração:** média — código não reaproveitável, mas o modelo de domínio é o
  blueprint mais próximo do Knowledge Hub.
- **Maturidade:** maduro para ingestão/busca/chat/transformações; multiusuário e agentes via MCP
  apenas em visão de futuro (VISION.md).
- **Adoção:** domínio notebook/source/note/insight sobre tabelas SQLite (→ `05` §3); fila em
  tabela + worker (padrão já our"); híbrido FTS5+vetor (→ `adr/ADR-EVO-006`); transformações
  parametrizadas; abstração de provider (o router `llm.js` já exerce esse papel).

## 4. Parlant — emcie-co/parlant

- **Branch/SHA:** `develop` @ `ea737442b8ae65854a842542e544fbe7e6144bad` (2026-07-10).
- **Licença:** Apache-2.0 (`LICENSE` + `pyproject.toml`).
- **Stack:** FastAPI/uvicorn, widget React, SDKs Python/TS; persistência com pymongo e vetor
  via nano-vectordb embutido; LLM-agnostic.
- **Padrões reutilizáveis:** engenharia de contexto por matching — em vez de prompt monolítico,
  um motor avalia por turno quais observations/guidelines/tools/journeys entram no prompt;
  guidelines = pares condição→ação com relações `exclude`/`dependencies`; journeys como grafo de
  estados multi-turno; tools só entram em contexto quando a observation casa; **canned responses
  STRICT** para momentos críticos (elimina alucinação por template pré-aprovado); OpenTelemetry
  nativo para explicabilidade. Human handoff citado na documentação, não verificado no código
  nesta pesquisa.
- **Complexidade de integração:** alta portado (Python async com muitas deps); média como
  sidecar (`parlant-server` + SDK TS).
- **Maturidade:** maduro para governança conversacional; foco B2C/B2B, não assistente pessoal.
- **Adoção:** conceitos de governança no backend (→ `adr/ADR-EVO-007`): guidelines condição→ação
  versionadas, relações de conflito/prioridade, canned responses para comandos destrutivos do
  host, tracing por decisão. O motor é implementado internamente (Node) — o backend avalia
  políticas; o modelo nunca é o único enforcement. Sidecar Parlant fica como alternativa se
  escala futura justificar.

## 5. Agent S — simular-ai/Agent-S

- **Branch/SHA:** `main` @ `0fff0e634869dab72027435b4586e62300185d41` (2026-10-21).
- **Licença:** Apache-2.0 (`LICENSE` na raiz; observação: campo de copyright não preenchido no
  boilerplate). Licenças de pesos/modelos específicos não verificadas.
- **Stack:** Python (pyautogui, paddleocr, etc.) com modelo de grounding dedicado (ex.:
  UI-TARS-1.5-7B) e LLM de fronteira em API cloud.
- **Padrões reutilizáveis:** separação planner (decide) / grounding agent (localiza e traduz
  para ação); reflexão pós-ação; trajectory limitada (máx. 8 imagens); Behavior Best-of-N;
  verificação visual por screenshot; S4 usa **Landlock** como sandbox do Builder e SQLite como
  estado de evolução de variantes; avaliação em benchmarks padronizados (OSWorld etc.).
- **Complexidade de integração:** alta — orientado a pesquisa/benchmark; não é para embutir.
- **Maturidade:** S3 maduro em benchmark; S4 experimental (out/2026).
- **Adoção:** apenas padrões para a fronteira da Fase 5 (→ `adr/ADR-EVO-008`): planner/executor
  separados, pós-condição visual com captura de evidência, isolamento tipo sandbox, reconciliação
  de estado. O navegador isolado existente (worker + egress broker) permanece o padrão de
  execução de UI — não criar subsistema concorrente.

## 6. Síntese e recomendação

| Projeto | Licença | Padrão de maior valor | Fase de destino |
|---|---|---|---|
| DeepTutor | Apache-2.0 | Memória em camadas + sessões retomáveis + capability runtime | 1, 2, 4 |
| AutoGPT | PolyForm Shield (platform) / MIT (classic) | Grafos versionados, spending controls, credenciais escopadas | 1, 3 |
| Open Notebook | MIT | Modelo notebook/source/insight, busca híbrida em um banco, fila em tabela | 2 |
| Parlant | Apache-2.0 | Guidelines condição→ação, canned responses, explicabilidade | 3 |
| Agent S | Apache-2.0 | Planner/grounding, verificação visual, sandbox | 5 |

Nenhuma dependência nova de runtime é introduzida nesta fase. Todas as adoções são
reimplementação conceitual em Node/SQLite, com revisão por fase e testes próprios.

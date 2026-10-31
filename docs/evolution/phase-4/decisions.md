# Decisões Técnicas — Fase 4

## ADR-RS-001 — Provedor de busca padrão DDG-HTML por trás de interface substituível

**Status:** ACCEPTED · **Contexto:** não há credenciais de provedores de busca API configuradas
nesta instalação; o scraping DDG existente (`tools.js` web_search) funciona sem chave, porém é
frágil. **Decisão:** interface única (`webSearchStructured`, `server/research-search.js`) com
provedor padrão `ddg-html` + `setSearchFetcher` para injeção (testes/fixtures/provedores
futuros); indisponibilidade é explícita (`unavailable` + audit) e NUNCA gera resultados
fictícios. **Consequências:** trocar de provedor = uma função; qualidade do provedor atual é
limitação documentada.

## ADR-RS-002 — Investigação como workflow da Fase 3 (registry de nós), não executor próprio

**Status:** ACCEPTED · **Contexto:** o mandato proíbe executor de pipelines paralelo.
**Decisão:** o Workflow Engine ganhou um REGISTRY (`registerNodeExecutor`/`registerNodeType` —
extensão mínima) e a pesquisa registra 6 nós (`research_hub`, `research_web`, `research_retrieve`,
`research_evidence`, `research_synthesis`, `research_report`); cada investigação cria/reutiliza
uma definição de workflow auto-gerada (`research:<projectId>`) e executa via `startWorkflowRun` —
herdando versionamento, checkpoints, recovery, reconciliação, políticas e orçamento.
**Consequências:** zero runtime novo; o grafo de pesquisa é observável no Workflow Studio.

## ADR-RS-003 — Evidência com citação VERBATIM validada no servidor

**Status:** ACCEPTED · **Contexto:** citação inventada pelo modelo é o principal risco de
integridade. **Decisão:** `nodeResearchEvidence` aceita uma citação somente se ela existir
( normalizada por whitespace/case) dentro do conteúdo real da fonte; rejeições são auditadas;
citações de relatório vêm dos registros de fonte (autoritativas). **Consequências:** impossível
citar trecho inexistente via pipeline; sínteses podem ainda interpretar mal (revisão humana).

## ADR-RS-004 — Learning Engine com progresso de contagens (sem "domínio")

**Status:** ACCEPTED · **Contexto:** inferir domínio/competência a partir de tentativas seria
métrica sem metodologia validada (e traço pessoal sensível). **Decisão:** progresso = contagens
explícitas (attempts/correct/incorrect/undetermined por lição); `correct` pode ser `null`
(indeterminável); nada vira memória automática. **Consequências:** honesto por construção;
gamificação/domínio ficam para decisão de produto futura.

## ADR-RS-005 — Narração via TTS existente (sem geração nova)

**Status:** ACCEPTED · **Contexto:** xtts/TTS local existe e é opt-in. **Decisão:** narração é
uso opcional do TTS existente pela UI (texto da lição/explicação); nenhuma geração nova de
áudio/podcast nesta fase; sem TTS configurado a experiência textual permanece completa.

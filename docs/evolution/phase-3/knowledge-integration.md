# Integração com o Knowledge Hub — nós `knowledge_search` e `transform`

## Nó `knowledge_search` (`server/workflow.js:443-462` → `server/knowledge.js:604`)

- **Entrada:** `query` (interpolação `$node.*`, :447), `notebook_id`/`library_id` opcionais,
  `limit` com clamp 1-10 (`Math.min(Number(config.limit) || 5, 10)`, :449).
- **Execução:** `khSearch(owner, ...)` — busca sempre no acervo **do owner do run**, sem
  escopo delegável:
  - Escopo SQL por `owner_admin_id` + filtro opcional de notebook/biblioteca com verificação
    `owns()` (`knowledge.js:619-630`); hits fora do escopo autorizado são descartados
    (:655, :674).
  - Fusão híbrida FTS5 (BM25) + pipeline RAG, score 0.5/0.5 (:641-711).
- **Saída do nó:** `results[]` com `source_id`, `title`, `chunk` (chunk_index), `score`,
  `snippet` (≤500) e o objeto **`citation`** completo (:452-461). A citação é gerada pelo
  servidor a partir do trecho realmente recuperado — `source_id`, `source_title`,
  `document_id`, `chunk_id`, `chunk_index`, `mode` (`fts5`|`rag`|`hybrid_fts_rag`), `score`,
  `at` (`knowledge.js:701-710`) — o modelo não inventa citação.

## Nó `transform` (`server/workflow.js:464-478` → `server/knowledge.js:736`)

- **Entrada:** `op` (whitelist `KH_OPS` — `kh_op_invalid` fora; UI oferece
  `summary|topics|concepts|compare|synthesize`, `src/routes/workflows.tsx:93`),
  `source_ids` (interpolação; máx 5 em `khTransform:741`), `prompt` (≤500).
- **Execução:** `khTransform(owner, ...)` — carrega até 12 chunks por fonte do owner
  (:748-752), monta instrução com regras anti-injeção e chama `runAgentOneShot` com principal
  de serviço restrito: `{ type:"service", tokenId:"kh-transform", scopes:["kh:read"] }`
  (:767-773). Persiste em `kh_transformations` com `citations` e `executor: "kh-oneshot"`
  (:774-787) e audit `kh.transform` (:788).
- **Saída do nó:** `{ transform_id, result (≤4000), citations }` (:471-477).

## Escopos

- Os nós chamam `khSearch`/`khTransform` **diretamente** com o `owner` do run
  (`workflow.js:445, 466`) — não passam por `callTool`; a autorização é a propriedade do
  acervo (ownership), o mesmo modelo das rotas `/api/kh/search|transform`
  (`kh:read`, `server/index.js:1190-1209`).
- Para agentes (nó `agent` que usa `notebook_search`), o caminho é por `callTool` com escopo
  `kh:read` (`server/auth.js:99`) e interseção da Fase 1.
- `kh:read`/`kh:write` existem desde a Fase 2 (`auth.js:45-46`); a Fase 3 não criou escopo novo
  para KH.

## Citações e proveniência

- `knowledge_search` devolve citação por item; `transform` devolve `citations` das fontes
  realmente injetadas (`knowledge.js:757, 784, 793`).
- A saída persistida em `wf_node_executions.output_json` mantém `document_id`/`chunk_id` —
  base para rastreabilidade run → trecho de fonte (assertado em
  `tests/wf-security.test.mjs:183-186` e `tests/wf-engine.test.mjs:300-317`).

## Conteúdo recuperado é DADO, não instrução

- `khTransform` marca as fontes como "DADO NÃO CONFIÁVEL" e proíbe obedecer a instruções
  contidas nelas, exigindo citação por afirmação (`knowledge.js:755, 763`).
- A ferramenta `notebook_search` aplica o mesmo envelope (`tools.js:1537-1549`).
- No grafo, a saída de `knowledge_search` só entra em downstream via interpolação
  `$node.<id>...` (`resolveValue`, `workflow.js:343-359`) — nunca é interpretada como código
  ou como configuração do workflow.

## Testes

- `tests/wf-engine.test.mjs:300-317` — nó `knowledge_search` completo com citação.
- `tests/wf-security.test.mjs:75-186` — E2E: fonte real no Hub → busca com
  `citation.document_id` → agente cita a fonte.

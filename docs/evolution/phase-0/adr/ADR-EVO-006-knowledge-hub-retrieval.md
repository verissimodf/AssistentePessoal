# ADR-EVO-006 — Knowledge Hub e arquitetura de recuperação (busca)

**Status:** ACCEPTED (decisão técnica; escopo de produto da Fase 2 segue PROPOSED no roadmap) ·
**Data:** 2026-10-30 · **Fase:** 0

## Contexto
Busca atual: cosine O(N) em JS sobre chunks/memórias do owner (`documents.js:515-525`,
`tools.js:884-901`), embeddings em JSON blob, sem full-text indexado. Citações com snapshot
(`meta.citations`) já existem. Referências: Open Notebook usa busca híbrida BM25+vetorial no
mesmo banco (ADR-001 do projeto); DeepTutor usa workspaces com re-index rastreável.

## Problema
Escalar busca semântica e full-text do Knowledge Hub sem introduzir serviço de banco novo.

## Opções consideradas
1. Manter cosine O(N) em JS.
2. Serviço vetorial dedicado (Qdrant, pgvector+Postgres, FalkorDB).
3. Extensões embutidas no SQLite: FTS5 (full-text) + extensão vetorial (sqlite-vec ou
   equivalente), com fallback lexical existente mantido.

## Decisão
Opção 3 para busca; modelo notebook/source/note/insight sobre tabelas relacionais (grafo como
arestas SQL, `05` §3) — sem banco de grafos dedicado.

## Racional
- Elimina a complexidade O(N) com zero serviços novos; operação local-first preservada.
- Open Notebook demonstra que busca híbrida no mesmo banco do domínio funciona em produção
  (`07` §3).
- Escopo pessoal (1-2 admins) não justifica infra de grafo dedicada; consultas de vizinhança são
  SQL.
- Migração incremental: índices construídos por re-index rastreável (padrão DeepTutor), falha de
  indexação nunca apaga a fonte.

## Consequências
- Positivas: performance previsível, uma só superfície de backup/restore (banco + `master.key`).
- Negativas: limite prático de escala do sqlite-vec; caminho de saída documentado — se medição
  mostrar limite, migrar para serviço dedicado (`03` §5).

## Implicações de segurança
Ownership continue em JOIN em toda busca; citações mantêm snapshot; nenhuma nova borda de rede.

## Alternativas rejeitadas
1 (não escala); 2 (infra nova sem evidência — contra as regras de priorização do roadmap).

## Referências
`03` §4 (matriz); `05` §3; `07` §1 (DeepTutor), §3 (Open Notebook); `server/documents.js`;
`adr/ADR-EVO-005`.

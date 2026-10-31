# Limitações Reais e Itens Adiados — Fase 2

Documentadas com transparência — nada aqui está marcado como "concluído" em outro lugar.

## Funcional

1. **Sem extensão vetorial nativa** — a perna vetorial usa cosine em JS sobre os embeddings
   existentes (`searchDocuments`). Correta e testada, mas O(N) por consulta no acervo do owner;
   para acervos grandes, migrar para extensão embutida (ADR-KH-001 registra o gatilho).
2. **HTML/XLSX não suportados** — sem parser operacional no pipeline; falha fechada com 415
   (`unsupported_type`). Não há suporte fictício.
3. **Áudio/vídeo não suportados como fonte** — a infraestrutura STT existe (whisper.cpp, opt-in),
   mas a ingestão transcrita de mídia não foi implementada nesta fase (requer definir consentimento
   e pipeline de transcrição como job durável — candidato à Fase 6).
4. **Embeddings dependem de provedor disponível** — sem Ollama/OpenAI no momento da ingestão, a
   fonte fica `partial`/`lexical_only` (pesquisável via FTS5/lexical). Reprocessamento via
   `POST /api/kh/sources/:id/ingest` ou `reindexDocument`.
5. **`khAsk` é one-shot** — não persiste conversa própria; o caminho com histórico persistente
   (com citações em `meta.citations`) é o chat normal usando `notebook_search`.

## Contratos reservados (não implementados nesta fase)

6. **Versionamento de fontes via re-upload** — `kh_source_versions` existe e a ingestão registra
   versões, mas o fluxo de "atualizar fonte" (PUT com novo conteúdo → versão+1 → reindex) não
   está exposto na API/UI desta fase; a exclusão/recriação cobre o caso comum.
7. **Relacionamentos inferidos** — `kh_relationships` suporta `kind: 'inferred'` com confidence,
   mas não há extração automática de entidades/relações (seria inferência de modelo virando
   grafo — exigiria política de revisão; fica para fase posterior com governança).
8. **Nota promovida a memória** — a integração com memória é por ferramenta `remember`
   (existente) com citação da fonte; não há botão "promover trecho a memória" na UI do Hub.

## Operacionais

9. **Ingestão single-thread in-process** — `max_jobs_concurrent: 1`; adequado ao operador
   pessoal; não paraleliza uploads em lote.
10. **Smoke E2E com modelo real** — as respostas fundamentadas foram testadas com one-shot fake;
    com modelo real, a qualidade da citação depende do provedor (a citação autoritativa do
    backend limita o pior caso).

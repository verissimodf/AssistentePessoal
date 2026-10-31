# Fase 2 — Personal Knowledge Hub (J.A.R.V.I.S. Evolution)

**Status:** implementada · **Branch:** `evolution/phase-2-personal-knowledge-hub-20261030` · **Base:** `de02d67` (Fase 1)
**Escopo:** acervo de conhecimento pessoal local-first — bibliotecas, notebooks, fontes com
proveniência, ingestão durável, pesquisa híbrida (FTS5 + semântica), respostas fundamentadas
com citações verificáveis, transformações e integração com o Agent Workforce.

## Princípio da implementação

**Reutilizar o pipeline existente:** as fontes do Hub referenciam documentos do pipeline atual
(`documents.js` — chunks, embeddings, busca, citações), sem duplicar armazenamento. O Hub adiciona
organização (bibliotecas/notebooks), versionamento, FTS5 (BM25), jobs de ingestão duráveis,
proveniência e relacionamentos — tudo no SQLite (migração v21), sem novos serviços.

## Documentos

| Documento | Conteúdo |
|---|---|
| [`architecture.md`](architecture.md) | Arquitetura da camada e o que é reutilizado vs. novo |
| [`data-model.md`](data-model.md) | Entidades, constraints, ownership, ciclo de vida |
| [`ingestion-pipeline.md`](ingestion-pipeline.md) | Ingestão durável, dedupe por hash, recuperação, exclusão |
| [`hybrid-search.md`](hybrid-search.md) | FTS5 + vetorial: fusão, piso de relevância, filtros |
| [`grounded-chat.md`](grounded-chat.md) | Respostas fundamentadas, citações autoritativas |
| [`notebooks.md`](notebooks.md) | Bibliotecas, organização, relacionamentos |
| [`memory-integration.md`](memory-integration.md) | Integração com os três domínios de memória |
| [`agent-tools.md`](agent-tools.md) | Ferramentas do Workforce (notebook_*) |
| [`security-threat-model.md`](security-threat-model.md) | 14 ameaças KH + invariantes + riscos aceitos |
| [`api-contracts.md`](api-contracts.md) | Rotas /api/kh/* com payloads e erros |
| [`operations.md`](operations.md) | Operação, diagnóstico e recuperação |
| [`testing.md`](testing.md) | Suítes, cobertura por categoria, resultados reais |
| [`decisions.md`](decisions.md) | ADR-KH-001..006 |
| [`traceability-matrix.md`](traceability-matrix.md) | Critérios de aceite → implementação → testes |
| [`limitations.md`](limitations.md) | Limitações reais e itens adiados |

## Critérios de aceite — resumo

Todos os itens críticos atendidos (checklist completo com evidências em
[`traceability-matrix.md`](traceability-matrix.md)); limitações honestas em
[`limitations.md`](limitations.md) — nenhuma funcionalidade está marcada como concluída sem
fluxo funcional real.

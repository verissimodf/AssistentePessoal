# Limitações Reais e Itens Adiados — Fase 4

## Pesquisa

1. **Provedor de busca sem credenciais** — o padrão é DDG-HTML (scraping, sem chave): frágil a
   mudanças de layout e sem campos avançados (janela temporal, paginação estruturada,
   publicação data). A interface é substituível (ADR-RS-001); configurar um provedor de API é
   decisão do operador (não há chave nesta instalação — nada é simulado).
2. **Sem execução web real nos testes** — toda a suíte usa fixtures explícitas
   (`setSearchFetcher`); a verificação com busca real é verificação manual (o CI não deve
   depender de rede). A demonstração de indisponibilidade também é testada.
3. **Detecção de contradições delegada ao modelo** — os conflitos são os que a síntese declara
   (persistidos com fontes); não há detector semântico independente.
4. **Profundidade de investigação fixa** — um ciclo por execução + aprofundamento manual
   (`deepen`); ciclos automáticos múltiplos exigiriam orçamento dinâmico (adiado).
5. **Conteúdo de página truncado** (100 KB/fonte) e número de recuperações limitado (12/projeto).

## Learning

6. **Sem rastreamento de "domínio"** — progresso é contagem explícita (ADR-RS-004).
7. **Jornada regenerável não editável** — o plano é gerado uma vez (regenerar = novo projeto);
   edição manual de módulos/lições não exposta nesta fase.
8. **Tutor sem conversa persistente própria** — cada pergunta é one-shot com contexto da lição;
   histórico longo usa o chat normal; journal registra o que o usuário quiser guardar.
9. **Exercícios objetivos via modelo** — o `correct` pode ser `null` (indeterminável) e o
   feedback depende do provedor LLM configurado.

## Plataforma

10. **Narração** — usa o TTS existente pela UI (opt-in); sem STT em fluxo de tutoria e sem
    podcast/geração de áudio nova.
11. **Métricas de qualidade de pesquisa** — não existem (mandato proíbe inventar); só métricas
    de execução (contagens, durações, estados).

# Ajustes finos

- **Sensibilidade das palmas**: 1 (precisa bater forte) a 10 (microfones de ganho baixo). Intervalo aceito entre as duas palmas: 120–700 ms (`src/lib/clap.ts`).
- **Modelo de embeddings**: `nomic-embed-text` no Ollama (`ollama pull nomic-embed-text`). Sem embeddings, a memória usa busca por palavras.
- **Comandos permitidos**: Configurações → Geral → Comandos permitidos (prefixos separados por vírgula).
- **Porta**: `JARVIS_PORT` no `.env`.
- **Instruções do agente**: combine modelos de instruções na tela Agentes.

# Limitações Reais (Fase 6)

Limitações **honestas** desta fase — nada aqui é simulado ou declarado como feito sem ser.

## Voz

- **STT indisponível por padrão neste ambiente**: o serviço whisper.cpp (`stt:8080`/
  `JARVIS_STT_URL`) não estava em execução durante o desenvolvimento. Toda a cadeia de
  STT está implementada e testada com fixtures explícitas (`fetchFn` injetado); com o
  serviço ativo (`scripts/stt-entrypoint.sh`), a modalidade funciona sem mudanças de
  código. A indisponibilidade é sempre EXPLÍCITA — nunca há transcrição fictícia.
- **Sem VAD server-side**: início/fim de fala são marcados pelo usuário (controle
  explícito); a transcrição só entra na conversa após envio confirmado (ADR-MM-007).
- **Sem transcrição parcial** (`transcription.partial`): o endpoint whisper.cpp
  configurado devolve o texto completo; parciais não são emitidas nem inventadas.

## TTS

- Síntese REAL verificada via `xtts-service` (local, CPU): primeira síntese a frio
  demora (~110 s com carregamento do modelo; aquecido: ~14 s para uma frase). Os estados
  `voice_warming_up`/`voice_busy` cobrem isso com mensagens acionáveis.
- Áudio retornado como arquivo único (wav/mpeg): reprodução por segmentos e streaming de
  áudio (`response.audio.delta`) não estão disponíveis.
- Controle de velocidade: herdado do motor/profiro configurado; não há parâmetro
  dedicado nesta fase além do perfil de voz existente.

## Interrupção

- Cancelamento FÍSICO real: síntese TTS (AbortController) e reprodução no cliente.
- Cancelamento LÓGICO na geração: o resultado tardio é descartado, mas a troca
  persistida no histórico pela idempotência do chat não é apagada (ADR-MM-008).

## Streaming

- **Sem deltas de texto** (`response.text.delta`): o `runAgent` devolve a resposta
  completa; o streaming NDJSON existente (`/api/chat/stream`) transmite progresso de
  ferramentas, não tokens. Eventos definidos no contrato, porém não emitidos.
- Eventos multimodais chegam por **polling** (ADR-MM-004), não por push.

## Avatar

- Animação aproximada por estados (SVG/CSS): **não é lip-sync** — nenhuma sincronização
  fonema-boca é afirmada. A intensidade visual durante a fala é decorativa, não medida
  do áudio.
- Sem renderização 3D nem modelos de avatar animados: fora do escopo (custo/manutenção).

## Multimodalidade

- **Câmera/vídeo fora do escopo**: desativados por padrão e não implementados.
- Imagem como entrada: não implementada nesta fase (o chat de texto já aceita anexos
  pelas fases anteriores; o canal multimodal não adiciona processamento de imagem).

## Operação

- Sessões multimodais: 1 turno ativo por vez (sem dúplex simultâneo — o usuário fala OU
  ouve por turno).
- Teto de 500 eventos/200 turnos por sessão e expiração de 2 h de ociosidade.

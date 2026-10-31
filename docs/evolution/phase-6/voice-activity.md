# Detecção de Atividade de Voz (Fase 6)

## O que é operacional hoje

Não há VAD server-side nesta fase. A detecção de fim de fala é feita pelo **cliente**:

- `MediaRecorder` sem detecção automática: o usuário marca o fim da fala pressionando
  "parar captura" (controle explícito, sem ambiguidade de ruído).
- Limites configuráveis no cliente: duração máxima do clipe (teto de 15 MB imposto pelo
  servidor) e idioma do STT.

## Por que não tratar ruído como comando (§7.2)

O mandato exige que "qualquer ruído" nunca vire comando. A abordagem mais conservadora
que atende isso **por construção** é o gate duplo:

1. captura inicia/termina apenas por ação explícita do usuário (nada é gravado às escondas);
2. a transcriçãoresultante só entra na conversa após envio explícito.

Sem VAD automático, não existe caminho pelo qual ruído, silêncio ou áudio ambiente
gere mensagem ou ação.

## Caminho de upgrade (documentado, não implementado)

VAD real (ex.: `silero-vad` local ou análise de RMS no `AudioWorklet` do cliente com
limiares de silêncio/duração configuráveis) pode ser adicionado depois **como
acelerador do fluxo acima** — ele apenas marca o fim da captura; a barreira de
confirmação de envio permanece obrigatória. ADR registrada em decisions.md (MM-007).

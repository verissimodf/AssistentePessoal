# Sincronização Audiovisual do Avatar (Fase 6)

## Princípio (§9.3)

Sincronização baseada em **eventos e estado real** — nunca em simulação:

- **`speaking` ↔ áudio**: o componente Avatar recebe callbacks do elemento `<audio>`
  (`play`/`playing` → estado speaking; `pause`/`ended`/`error` → volta ao estado
  anterior). Se não há áudio tocando, NÃO há animação de fala — garantido por
  construção e coberto por teste.
- **`listening` ↔ captura**: o estado listening só é emitido enquanto as tracks do
  `MediaRecorder` estão ativas (`stream.active`). Encerrou a track → deixa de ouvir.
- **`thinking` ↔ processamento**: turnos em `transcribing/processing/generating`
  (estado persistido, consultado após cada ação e no polling de eventos).
- **Interrupções e conclusão**: eventos `response.interrupted` e `response.completed`
  do motor (via `mm_turns.state`) movem o avatar imediatamente.

## O que NÃO é afirmado

- **Não é lip-sync**: a intensidade das ondas durante a fala é uma animação CSS
  decorativa ligada ao fato de o áudio estar tocando — não à amplitude do sinal nem a
  fonemas. Nenhum texto desta fase declara sincronização fonema-boca.
- Não há análise de espectro do áudio (custo/complexidade sem ganho operacional agora).

## Caminho de upgrade (documentado, não implementado)

Análise de amplitude real via `AnalyserNode` (WebAudio) alimentando a intensidade das
ondas; visemas para lip-sync — ambos pluggables no contrato atual
(`avatarStateFromTurn` + eventos), sem mudanças no motor.

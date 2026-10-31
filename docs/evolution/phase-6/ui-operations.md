# Multimodal Studio — Operação da Interface (Fase 6)

## Localização

- Rota: `src/routes/multimodal.tsx` (aba "Multimodal" no menu do painel).
- Helpers testáveis: `src/lib/multimodal-ui.ts` (`avatarStateFromTurn`,
  `describeTurnState`, `shouldReduceMotion`).
- Avatar: `src/components/Avatar.tsx` (SVG/CSS, sem dependências).

## O que o operador vê e faz

1. **Selecionar/criar conversa** (reuso das rotas `/api/conversations`) e abrir uma
   sessão multimodal sobre ela.
2. **Falar**: botão de microfone — a captura SÓ inicia com o clique (getUserMedia
   explícito); badge vermelho + `aria-live` indicam captura em curso; "parar" encerra as
   tracks. Sem permissão/dispositivo: indisponibilidade explícita, fallback por texto.
3. **Enviar áudio por upload** como alternativa ao microfone.
4. **Digitar**: campo de texto que cria um turno na MESMA sessão (alternância texto/voz).
5. **Revisar a transcrição**: visualizar, editar (correção manual) e ENVIAR por botão
   explícito — a transcrição nunca é enviada sozinha.
6. **Ouvir a resposta**: botão "falar" sintetiza (TTS) e reproduz; o botão de interromper
   para o áudio e interrompe o turno no servidor.
7. **Avatar**: estado sempre coerente — listening só com microfone ligado, speaking só
   com áudio em reprodução, thinking durante transcrição/processamento, error/unavailable
   quando a modalidade falha ou está indisponível.
8. **Histórico de turnos** com estados e latências observadas (`transcription_ms`,
   `generation_ms`, `tts_ms`).
9. **Fechar sessão**: interrompe turnos ativos e encerra a captura.

## A qualquer momento o usuário entende (§13)

O cabeçalho do Studio mostra o estado composto (ouvindo / transcrevendo / processando /
falando / interrompida / erro / modalidade indisponível), derivado apenas do estado real
persistido (`mm_turns.state` + eventos) — nunca de uma suposição otimista do cliente.

## Fallback e acessibilidade

- **Fallback textual integral**: sem microfone, sem TTS ou sem avatar, todas as funções
  continuam acessíveis por texto.
- **Internacionalização**: todas as strings em pt/en/es (`src/lib/i18n.tsx`, chaves `mm.*`).
- **Responsivo e acessível**: controles com `aria-label`, região `aria-live` para estados
  de captura, `prefers-reduced-motion` desliga animações (avatar estático com cor/ícone).

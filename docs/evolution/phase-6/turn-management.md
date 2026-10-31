# Turn Management e Interrupções (Fase 6)

## Máquina de estados (§7.1)

```
idle ──► listening ──► transcribing ──► processing ──► generating ──► completed ──► speaking*
   │           │              │              │                             ▲
   │           └──────────────┴──────────────┴──► interrupted / failed     │
   └──────────────────────────────────────────────────────────────────────┘
* speaking é pós-completed (síntese/reprodução da resposta) e pode virar interrupted.
```

Os estados refletem o processamento REAL: cada transição é gravada no banco com
`updated_at` e acompanhada de eventos; nada é simulado.

## Regras de consistência

- **Um turno ativo por sessão** (`mm_turn_concurrent`) elimina corridas de turnos
  concorrentes.
- **Guarda de obsolescência**: se um turno é interrompido durante a geração, o resultado
  tardio é descartado (`sendTurn` checa o estado persistido após `chatExchange`) — uma
  resposta antiga nunca substitui um turno mais recente.
- **Fechamento de sessão** interrompe todos os turnos ativos (`mm_session_closed`).
- **Timeout**: turno transitório além de 5 min falha (`mm_turn_timeout`); sessão ociosa
  além de 2 h fecha.
- **Boot**: turnos transitórios que sobreviveram a um reinício falham
  (`mm_interrupted_boot`) — nenhum turno fica "falando" para sempre.

## Interrupção real

- Síntese (TTS): `AbortController` registrado por turno (`inflightTts`); interromper
  aborta o fetch em curso — verificado em teste (o `signal` chega abortado ao fetch).
- Geração: `chatExchange`/`runAgent` não expõem cancelamento cooperativo; a interrupção
  marca o turno como `interrupted` e **descarta** o resultado tardio. A troca persistida
  no histórico pela idempotência do chat não é apagada (dados nunca são apagados
  silenciosamente), mas o turno interrompido não a apresenta nem a fala. Limitação
  documentada em limitations.md.
- Captura: o cliente encerra as tracks do `MediaRecorder`; o turno vira `interrupted`.

## Contexto compartilhado (§7.4)

Texto, transcrição e áudio participam do MESMO histórico: o turno grava
`input_text` (texto efetivamente enviado) em `conversation_messages` da conversa
associada, com ordem, identidade e proveniência preservadas. Não há conversas separadas
por modalidade.

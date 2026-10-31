# Text-to-Speech (Fase 6)

## Provedores (existentes, substituíveis — ADR-MM-002)

O motor multimodal **reusa** `server/voice.js` sem modificar seu contrato:

| Motor | Onde roda | Seleção |
|---|---|---|
| `xtts` (ou `kokoro`) | adaptador de voz local `127.0.0.1:7778` (`scripts/instalar-voz.sh`) | `admin_settings.voice.tts` |
| `elevenlabs` | nuvem (chave própria do admin) | `admin_settings.voice.tts = "elevenlabs"` |

Prioridade do mandato atendida: execução local quando operacional, pt-BR suportado pelo
XTTS, controle de velocidade/voz pelos mesmos perfis existentes (incluindo voz clonada).
A disponibilidade REAL é verificada por síntese — nada é presumido.

## Contrato de síntese

`speakTurn(adminId, turnId, { lang })`:

- texto: **exatamente** `output_text` do turno — a resposta efetivamente produzida pelo
  sistema, sem alteração de conteúdo na síntese (§6.2);
- idioma: `pt-BR` (padrão do painel);
- perfil de voz: o configurado pelo admin (`voice` settings);
- áudio: devolvido na resposta HTTP (`audio/wav` local / `audio/mpeg` ElevenLabs);
- identificação: o turno guarda em `audio_meta_json` apenas `{ type, bytes, tts_ms }`.

## Reprodução (cliente)

No Multimodal Studio: reproduzir (play), interromper (stop + `/interrupt`), estado de
carregamento e erros mapeados. Pausa/retomada por segmento ficam dependentes do formato
retornado pelo provedor (wav único hoje) — documentado em limitations.md.

## Cancelamento

- `interruptTurn` aborta o `AbortController` da síntese em curso (registro
  `inflightTts`): o fetch do TTS é **realmente cancelado**;
- o turno vira `interrupted` e a síntese abortada não entrega áudio;
- sobreposição de falas é impossível: um turno ativo por sessão (`mm_turn_concurrent`).

## Estados recuperáveis (propagados ao cliente)

`voice_warming_up` (cold-start do XTTS, ~40 s na primeira chamada), `voice_busy` (fila
cheia), `voice_timeout`, `voice_unavailable` — códigos estáveis com `retry-after`; a
interface orienta o usuário em vez de mostrar erro genérico.

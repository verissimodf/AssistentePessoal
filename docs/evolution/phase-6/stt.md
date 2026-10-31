# Speech-to-Text (Fase 6)

## Provedor

Reuso do adaptador local existente (`server/stt.js`): **whisper.cpp** atrás de serviço
privado (`JARVIS_STT_URL`, padrão `http://stt:8080`), executado localmente via Docker
(`scripts/stt-entrypoint.sh`). Nenhuma nuvem, nenhuma chave. ADR-MM-002.

## Entrada de áudio

- **Microfone**: captura iniciada EXPLICITAMENTE pelo usuário no Multimodal Studio
  (MediaRecorder, `getUserMedia` somente no clique; indicador visível e interrompível).
- **Upload de arquivo**: alternativa sem microfone.
- A captura no servidor é apenas MARCADA (`startCapture` → turno `listening`); o áudio
  transita por HTTP multipart no momento do envio e não é armazenado.

## Validação (antes de tocar o provedor — nunca confiar na extensão)

Já implementada em `stt.js` e reutilizada integralmente:

- tamanho: 16 B a 15 MB (`audio_too_large`);
- MIME permitido: `audio/webm`, `audio/ogg`, `audio/wav`, `audio/x-wav`, `audio/mp4`,
  `audio/mpeg` (`audio_type_unsupported`);
- **assinatura de bytes** (EBML, `OggS`, `RIFF/WAVE`, `ftyp`, ID3/MPEG sync)
  (`audio_signature_invalid`);
- rate limit de 12 req/min por admin (`stt_rate_limited`);
- uma transcrição por vez (`stt_busy`).

## Contrato de saída

`transcribeAudio` devolve `{ text, engine: "whisper.cpp-local", language }`; o motor
multimodal guarda no turno, em `transcript_json`:

- texto reconhecido (sanitizado de caracteres de controle, ≤ 12.000 chars);
- idioma solicitado;
- engine e metadados do provedor;
- `latency_ms` observado (não meta arbitrária);
- `corrected: true` quando houver correção manual.

Timestamps por segmento: o endpoint whisper.cpp configurado devolve texto completo;
segmentos com timestamps só são registrados quando o provedor os fornece — nada é
inventado.

## Barreira de confirmação (§7.3)

A transcrição é **entrada candidata**: fica no turno (estado `transcribing`), aparece na
interface para visualização/correção/cancelamento e só entra na conversa com
`POST /api/mm/turns/:id/send` — um clique explícito do usuário. O reconhecimento de fala
não autoriza nada; comandos sensíveis continuam presos ao Policy Engine e ao D9.

## Indisponibilidade (explícita, nunca fictícia)

Serviço fora / timeout (45 s) → `stt_unavailable` (503); o turno falha com o mesmo código
e a interface mostra a modalidade como indisponível, mantendo texto e upload funcionais.

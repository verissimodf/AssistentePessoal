# Contratos de Provedores (Fase 6)

## STT — interface

```js
// server/stt.js (existente; reusado pelo motor multimodal)
transcribeAudio(adminId, file, { env?, fetchFn?, language? })
  → { text: string, engine: "whisper.cpp-local", language: string }
// erros: MailError(400|413|422|429|503, code estável)
```

- Substituição: qualquer provedor que atenda o contrato acima pode ser adaptado sem tocar
  no motor multimodal; para testes, `fetchFn` injeta fixtures (sem rede).
- Provedor local padrão: whisper.cpp (`JARVIS_STT_URL`), sem nuvem e sem chave.

## TTS — interface

```js
// server/voice.js (existente; reusado pelo motor multimodal)
tts(text, lang, adminId, { signal? })
  → { type: "audio/wav" | "audio/mpeg", data: Buffer }
// erros: VoiceError { code: voice_busy|voice_warming_up|voice_timeout|voice_unavailable|voice_error,
//                     state, retryAfter? }
```

- Substituição: `admin_settings.voice.tts` seleciona o motor; clonagem de voz existente
  (`cloneVoice`) continua funcionando.
- Para testes, `setVoiceFetch(fn)` injeta fixtures — nenhuma rede real nos testes.

## Regras de segurança comuns (§12.3)

- Credenciais nunca em logs; chaves só em `secret-crypto`/settings do admin.
- Nenhum dado privado sai da máquina sem configuração explícita (ElevenLabs é opt-in).
- Respostas dos provedores são **dados não confiáveis**: texto sanitizado, tamanho limitado,
  status HTTP não-confiado verificado.
- Timeouts e limites: STT 45 s + 15 MB; TTS orçamento morno/frio com tetos.
- Indisponibilidade explícita: cada falha tem código estável e a interface mostra a
  modalidade como indisponível — nunca um resultado fictício.

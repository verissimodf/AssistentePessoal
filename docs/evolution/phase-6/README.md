# Fase 6 — Experiência Multimodal

Branch: `evolution/phase-6-multimodal-experience-20261030` (base: `832450f`, Fase 5).

A Fase 6 integra voz, áudio, texto e elementos visuais ao J.A.R.V.I.S. **sem criar um
segundo backend conversacional**: o motor multimodal é uma camada de entrada/apresentação
sobre o sistema de conversas existente (`server/conversations.js`), que segue sendo a
fonte da verdade do histórico.

## Capacidades entregues

| Capacidade | Estado | Documento |
|---|---|---|
| Sessões multimodais persistentes com turnos | ✅ Implementado | [session-engine.md](session-engine.md) |
| STT (whisper.cpp local, substituível) | ✅ Implementado (indisponibilidade explícita se serviço fora) | [stt.md](stt.md) |
| TTS (xtts/kokoro local ou ElevenLabs, substituível) | ✅ Implementado (indisponibilidade explícita) | [tts.md](tts.md) |
| Turn management com interrupção real | ✅ Implementado | [turn-management.md](turn-management.md) |
| Streaming de eventos (NDJSON, padrão existente) | ✅ Implementado | [streaming.md](streaming.md) |
| Avatar sincronizado ao estado real | ✅ Implementado (SVG/CSS, sem dependências) | [avatar-experience.md](avatar-experience.md) |
| Alternância texto/voz na mesma conversa | ✅ Implementado | [session-engine.md](session-engine.md) |
| Correção manual de transcrição | ✅ Implementado | [stt.md](stt.md) |
| Detecção de fim de fala no servidor | ⚠️ Via silêncio do MediaRecorder do cliente | [voice-activity.md](voice-activity.md) |
| Captura de imagem/vídeo | ❌ Fora do escopo (câmera desativada por padrão) | [limitations.md](limitations.md) |

## Documentos

1. [architecture.md](architecture.md) — arquitetura multimodal
2. [session-engine.md](session-engine.md) — sessões e turnos
3. [stt.md](stt.md) — reconhecimento de fala
4. [tts.md](tts.md) — síntese de voz
5. [voice-activity.md](voice-activity.md) — detecção de atividade de voz
6. [turn-management.md](turn-management.md) — turnos e interrupções
7. [streaming.md](streaming.md) — transporte e eventos
8. [avatar-experience.md](avatar-experience.md) — avatar e estados
9. [avatar-synchronization.md](avatar-synchronization.md) — sincronização audiovisual
10. [provider-contracts.md](provider-contracts.md) — contratos de provedores
11. [agent-integration.md](agent-integration.md) — Agent Workforce
12. [research-integration.md](research-integration.md) — Deep Research
13. [learning-integration.md](learning-integration.md) — Learning Studio
14. [computer-integration.md](computer-integration.md) — Computer Studio
15. [memory-integration.md](memory-integration.md) — memória multimodal
16. [security-privacy.md](security-privacy.md) — segurança e privacidade
17. [retention.md](retention.md) — armazenamento e exclusão
18. [api-contracts.md](api-contracts.md) — contratos de API
19. [ui-operations.md](ui-operations.md) — Multimodal Studio
20. [migration.md](migration.md) — persistência (migração v25)
21. [operations.md](operations.md) — operação
22. [testing.md](testing.md) — testes e resultados
23. [traceability-matrix.md](traceability-matrix.md) — rastreabilidade requisito→código→teste
24. [limitations.md](limitations.md) — limitações reais
25. [decisions.md](decisions.md) — decisões técnicas (ADRs)

## Resumo de segurança

- Transcrição **não é autorização**: nada reconhecido por voz concede escopos; toda ação
  protegida continua passando por Policy Engine e D9 (resolução humana com fingerprint).
- Captura de microfone **somente por ação explícita**, com indicador visível e interrompível.
- **Nenhum áudio bruto é persistido no servidor**: transcrição + metadados bastam.
- Ownership: sessões multimodais têm linha própria em `ownership` (`mm_session`); dados de
  outro administrador são invisíveis.

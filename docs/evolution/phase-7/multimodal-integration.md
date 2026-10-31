# Integração — Multimodal Experience (Fase 7, §12.6)

- Notificações internas são apresentadas no painel (incluindo o contexto multimodal do
  Multimodal Studio).
- Leitura por TTS SOMENTE quando o usuário acionar "Falar" (ação explícita, interrompível
  — mecanismo da Fase 6 reutilizado; nenhuma fala automática disparada por gatilho).
- NENHUMA captura de áudio é ativada por notificação, gatilho ou rotina: o consentimento
  explícito da Fase 6 (microfone só no clique) é intocável.
- A interface de notificações respeita os estados do Studio (nada sobrepõe uma sessão
  multimodal em curso; notificações são conteúdo, não interrupção de fala).

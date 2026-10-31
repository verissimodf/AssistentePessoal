# Segurança e Privacidade (Fase 6)

## Ameaças consideradas e mitigações

### Captura sem consentimento
- `getUserMedia` só é chamado no clique explícito; a sessão de captura tem indicador
  visual permanente (badge) e botão de parar acessível.
- Nada ativa microfone ou câmera após reinicialização: não há auto-play de captura em
  nenhum código da fase; a câmera não é usada em lugar nenhum (vídeo fora do escopo).

### Microfone ativo após encerramento
- Fechar a sessão no Studio encerra as tracks do `MediaRecorder` (`stream.stop()`).
- O fechamento no servidor interrompe turnos ativos (`mm_session_closed`).

### Vazamento de áudio
- Áudio bruto não é persistido em disco nem no banco (ADR-MM-003); o áudio TTS sintetizado
  volta na resposta HTTP e não é gravado.

### Acesso cross-owner
- Todas as leituras/escritas passam por `owns(adminId, 'mm_session', …)`; para outro
  admin, sessão é invisível e eventos devolvem `null` → 404 uniforme.
- Turnos são sempre alcançados através da sessão (a qual pertence a um dono).

### Exposição de credenciais
- Nenhuma chave nova; STT é local (sem chave), TTS local sem chave, ElevenLabs usa a
  chave já gerenciada em settings (nunca no frontend, nunca em logs).

### Prompt injection por transcrição
- Transcrição é texto sanitizado; chega ao modelo como mensagem comum; testes verificam
  que texto injetado não cria aprovações nem executa comandos (teste 21).

### Comando sensível reconhecido (correta ou incorretamente)
- Reconhecimento não é autorização (§7.3): ações sensíveis exigem D9 humano com
  fingerprint na UI de aprovações; a voz não resolve aprovações.

### Bypass de D9 / Policy Engine
- O turno multimodal usa o MESMO `chatExchange` → `runAgent` → `callTool` do chat textual;
  não há caminho novo de execução de ferramentas (verificado por auditoria de rotas: as
  rotas `/api/mm/*` não chamam ferramentas).

### Retenção indevida / exclusão incompleta
- Áudio: nunca persistido. Eventos: teto de 500/sessão. Turnos: texto + metadados.
  Sessões ociosas: expiradas pelo tick. Tudo auditado sem conteúdo.

## Invariantes não negociados

- Nenhuma modalidade concede escopos ou aprovações.
- Nenhuma rota `/api/mm/*` é pública; todas exigem sessão verificada + CSRF.
- Nenhum dado multimodal vai a provedor externo sem configuração explícita do admin.

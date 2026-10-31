# Integração — Computer Studio (Fase 6)

## Regra central (§10.5)

**A voz não contorna a aprovação.** Toda ação de Computer Intelligence continua sujeita
ao Policy Engine e ao D9 com fingerprint — inclusive quando a solicitação veio por voz.

## Fluxo suportado

1. O usuário pede por voz (no Multimodal Studio, com a conversa aberta): "observe a
   página e planeje a tarefa X".
2. A transcrição confirmada chega ao modelo pela conversa; o modelo chama as ferramentas
   `computer_observe` / `computer_plan` (escopos `computer:read`/`computer:run`
   revalidados em `callTool` na execução).
3. Observação e PLANEJAMENTO podem ser solicitados por voz — são leitura/estruturação.
4. **Execução** (`computer_execute`) de ações de escrita segue gerando aprovações D9
   pendentes resolvidas apenas na UI de aprovações (humana, com fingerprint) — nunca por
   comando de voz, transcrição ou interpretação do modelo.

## Invariantes preservados da Fase 5

- Navegador gerenciado isolado por UDS; sem desktop nativo.
- Capturas com retenção controlada (removidas no fechamento).
- Ações proibidas por padrão (`PROHIBITED_PATTERNS`) continuam bloqueadas.
- Memória procedural só avança com execução verificada.
- Instruções exibidas na página continuam sendo dados não confiáveis (nada de bypass).

# Integração — Deep Research (Fase 6)

## Como a voz alcança as investigações

1. **Solicitar pesquisa por voz**: o usuário fala no Multimodal Studio; a transcrição
   confirmada vai para a conversa, e o modelo chama as ferramentas de pesquisa já
   existentes (`web_search`, fluxo `/api/research`) — exatamente como um pedido digitado.
2. **Acompanhar estados**: os painéis Deep Research existentes (`src/routes/research.tsx`)
   continuam sendo a superfície visual de acompanhamento; o Studio mostra o mesmo
   histórico da conversa.
3. **Receber sínteses faladas**: o botão "falar" do turno sintetiza via TTS o
   `output_text` do turno — a resposta efetivamente gerada.

## Proteções (§10.3)

- **Nada de narrar relatórios extensos indiscriminadamente**: o TTS fala a resposta do
  turno (curta por natureza do chat). Para trechos de relatórios, o usuário seleciona a
  parte na interface Deep Research e a envia como mensagem para ouvir — leitura sob
  demanda, nunca a transmissão integral de um relatório.
- **Citações ficam visuais**: fontes e citações verbatim (validadas no servidor na Fase 4)
  são consultadas na interface; a fala não substitui a citação verificável.
- Nenhuma pesquisa é disparada por reconhecimento de fala sem o envio confirmado.

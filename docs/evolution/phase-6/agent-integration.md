# Integração — Agent Workforce (Fase 6)

## Princípio

A interação por voz com especialistas acontece **pelo mesmo caminho do chat**: o turno
multimodal envia a transcrição confirmada via `chatExchange`, que roda `runAgent` com o
agente fixado na conversa (`conversations.agent_id`). O coordenador continua responsável
por planejamento, delegação, orçamento e agregação (Fase 1 intacta).

## O que a voz NÃO faz (§10.2)

- Não concede privilégios a agentes: a interface de voz não cria escopos, tokens ou
  permissões — delegação continua calculada no backend (`workforce.js`), com interseção
  de escopos por definição de especialista.
- Não autoriza execuções: aprovações D9 exigem resolução humana com fingerprint,
  vindas da UI de aprovações existente — uma frase dita no microfone não as resolve.
- Não muda o principal: o turno roda como o admin da sessão verificada (cookie + CSRF),
  nunca como token ou bot.

## Fluxo típico

1. Usuário abre o Multimodal Studio sobre uma conversa fixada em um especialista.
2. Fala a solicitação → STT → corrige se preciso → envia.
3. `chatExchange` roda `runAgent` (autonomia `confirm`): ferramentas e delegações
   seguem passando por `callTool` (revalidação) e D9.
4. A resposta textual pode ser falada (TTS) no mesmo turno.

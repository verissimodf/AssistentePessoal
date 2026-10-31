# Integração — Computer Intelligence (Fase 7, §12.5)

- Observação somente em sessões AUTORIZADAS da Fase 5: o motor proativo pode reagir a
  eventos `computer` (fonte registrada), mas NUNCA inicia sessões de navegador por
  conta própria.
- Nenhuma ação de Computer Intelligence nasce daqui: toda execução continua sujeita às
  verificações da Fase 5 — Policy Engine, ações proibidas por padrão e D9 com
  fingerprint resolvido por humano.
- Um workflow iniciado proativamente que contenha etapas de computer_* segue exigindo
  escopos `computer:*` (derivados no backend das `allowed_tools`) e D9 para escritas —
  a automação não contorna nada (teste 14-15 demonstra o bloqueio equivalente).

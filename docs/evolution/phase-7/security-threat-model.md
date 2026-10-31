# Segurança e Threat Model (Fase 7, §15)

## Ameaças cobertas

| Ameaça | Mitigação | Verificação |
|---|---|---|
| Usuário malicioso (admin) | só afeta os PRÓPRIOS recursos (ownership por dono); políticas globais exigem admin verificado | teste 26 |
| Agente comprometido | sem ferramenta proativa nova; `proactive:*` fora de BOT_SCOPES; agentes não criam/editam regras | teste 28 |
| Evento forjado | whitelist de fontes; fonte fora → rejeitado e não registrado | teste 11 |
| Regra maliciosa (condições aval arbitrária) | avaliador fechado sem eval; validação estrutural no save; limites de profundidade/nós com violação terminal | testes 1-3, 5-7 |
| Workflow alterado | runs fixam `definition_version`; edições de regra criam versão nova sem tocar runs em curso | teste 4 |
| Execução duplicada | dedupe no banco (UNIQUE parcial) + idempotencyKey no run | testes 8-10, 12-13 |
| Escalada de privilégios | execução só via Workflow Engine; escopos derivados no backend das allowed_tools | testes 14-15, 25 |
| Cross-owner access | todas as consultas filtram por dono; 404 uniforme | teste 26 |
| Replay de eventos | dedupe_key UNIQUE por dono | teste 8-10 |
| Aprovação obsoleta | D9 revalida na resolução; contexto alterado invalida (Fases 0-5 intocadas) | regressão |
| Prompt injection em fontes | payload é DADO: vira evidência/condição por campo, nunca instrução | teste 30 |
| Tempestade de eventos | teto de 60/min por dono (`pr_event_storm`) | teste 19 |
| Corrupção de estado | transições atômicas com grafo de estados; CHECKs no banco | teste 18 |
| Recuperação após crash | estados persistidos; `recoverProactive` + tick reconciliam com evidência | testes 20, 23 |

## Invariantes (§15)

- ownership sempre validado no backend (nenhum id confiado ao cliente);
- autorização nunca derivada de dados do cliente;
- eventos/conteúdo de documentos/pesquisas tratados como dados;
- execução protegida sempre passa pelo D9;
- logs sem segredos (auditoria registra só dono/ids/estados);
- nenhuma persistência desnecessária de conteúdo sensível (payloads limitados a
  metadados de correlação);
- nenhuma alteração nas integrações protegidas (Hermes/OpenClaw/Telegram/Gmail/SMTP).

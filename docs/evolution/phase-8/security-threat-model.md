# Segurança e Threat Model (Fase 8, §15)

## Invariantes → verificação

| # | Invariante | Verificação |
|---|---|---|
| 1 | Integrações não concedem permissões a si próprias | sem vínculo integração→scopes; `integrations:*` fora de BOT_SCOPES (teste 34) |
| 2 | Webhooks não são confiáveis por padrão | HMAC obrigatório; produtor forjado rejeitado (7-10) |
| 3 | Assinatura autentica, não autoriza | trust_level é do backend; payload não se auto-promove (7-10) |
| 4 | Evento externo ≠ aprovação humana | teste 32-33: D9 pendente mesmo com automação nível 2 |
| 5 | Protegidas exigem D9 | teste 32-33 + demo passos 10-11 |
| 6 | Aprovação vinculada a contexto/fingerprint | D9 da Fase 5/7 intocado (regressão) |
| 7 | Contexto alterado invalida aprovação | revalidação existente (regressão Fases 0-7) |
| 8 | Nenhum evento contorna o Policy Engine | execução só via startWorkflowRun (teste 19-20 + 25 da Fase 7) |
| 9 | Dados externos não alteram segurança | payload escalar limitado; campos de confiança descartados (14-16) |
| 10 | Nenhum segredo em logs/API | segredo cifrado e devolvido UMA vez (4-6); auditoria sem payload |

## Ameaças específicas → mitigações

| Ameaça | Mitigação |
|---|---|
| Produtor forjado | HMAC com segredo de 192 bits (CSPRNG); comparação em tempo constante |
| HMAC inválido | rejeição `if_signature_mismatch` (401) |
| Timestamp expirado | janela ±5 min (`if_timestamp_expired`) |
| Replay | idempotency_key UNIQUE no banco |
| SSRF/DNS rebinding | ingress não faz fetch orientado a dados; providers fixam HTTPS da API oficial |
| Redirecionamento proibido | sem fetch de URL de payload; nenhuma cadeia de redirecionamento seguida |
| Cross-owner | ownership em todas as leituras (teste 35) |
| Vazamento de credenciais | AES-256-GCM; segredo exibido uma vez; nunca em logs |
| Prompt injection | payload é dado; vira evidência (teste 14-16/30 da Fase 7) |
| Bypass de D9 | sem caminho alternativo (32-33) |
| Escalada de escopo | escopos derivados no backend das allowed_tools (intocado) |
| Evento malformado | validação de esquema/versão/tipo (14-16) |
| Tempestade | 30 ev/min por produtor (17-18) |
| Corrupção de estado | CHECKs + transições com guardas |
| Crash | aceitação durável + reconciliação por evidência (30/31) |

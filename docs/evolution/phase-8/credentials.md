# Gestão de Credenciais (Fase 8, §13)

## Princípio: não duplicar — reutilizar os mecanismos existentes

| Credencial | Armazenamento | Acesso |
|---|---|---|
| Segredo HMAC de produtor de webhook | `if_producers.secret_encrypted` — AES-256-GCM via `secret-crypto.js` (chave mestra em `JARVIS_MASTER_KEY` ou `data/master.key` 0600) | descriptografado SÓ no momento da verificação de assinatura |
| OAuth de calendário (google) | `oauth_connections.encrypted_refresh_token` (Fase anterior, intocado) | `getOAuthAccessToken` (renovação automática existente) |

## Regras (§13)

- **Segredo exibido UMA VEZ** na criação do produtor (`whsec_…` de 192 bits CSPRNG);
  depois NUNCA mais (API devolve metadados sem segredo — testado);
- **nada em arquivos versionados** (credenciais vivem no banco cifrado / chave mestra
  fora do repo);
- **nada em logs**: auditoria registra ids/estados; erros de rede registram código
  estável, nunca tokens/assinaturas;
- **sem exibição completa depois de configurada** — a UI mostra apenas a existência da
  credencial (e o aviso de segredo único);
- **sem acesso cruzado**: todas as operações filtram por dono (ownership);
- **revogação**: desativar a integração desliga produtores e contas; remoção da
  integração remove produtores (CASCADE) — segredos deixam de verificar.

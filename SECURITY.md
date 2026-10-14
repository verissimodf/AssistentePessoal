# Segurança

- O serviço escuta só em `127.0.0.1` e recusa navegadores de origens desconhecidas.
- Chaves de API ficam cifradas (AES-256-GCM) em `data/jarvis.db`; a chave mestra está em `data/master.key` (ou `JARVIS_MASTER_KEY`). Faça backup das duas juntas.
- **Ações no host** começam desligadas. Níveis de autonomia:
  - *Pedir confirmação*: todo comando aguarda **Aprovar** no painel (padrão da conversa).
  - *Só ações seguras*: roda apenas comandos da lista permitida, sem encadeamento (`;`, `&&`, `|`).
  - *Autônomo total*: roda qualquer comando, exceto os destrutivos bloqueados (formatar disco, `rm -rf /`, desligar…).
- Toda ação fica registrada na tabela `audit`.
- Para expor na rede (`JARVIS_HOST=0.0.0.0`), use apenas em rede confiável ou atrás de VPN.

Relate vulnerabilidades abrindo uma issue privada (Security advisories) no GitHub.

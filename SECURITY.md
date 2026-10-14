# Segurança

- O serviço escuta só em `127.0.0.1` e recusa navegadores de origens desconhecidas.
- Chaves de API ficam cifradas (AES-256-GCM) em `data/jarvis.db`; a chave mestra está em `data/master.key` (ou `JARVIS_MASTER_KEY`). Faça backup das duas juntas.
- **Ações no host** começam desligadas. Níveis de autonomia:
  - *Pedir confirmação*: todo comando aguarda **Aprovar** no painel (padrão da conversa).
  - *Só ações seguras*: roda apenas comandos da lista permitida, sem encadeamento (`;`, `&&`, `|`).
  - *Autônomo total*: roda qualquer comando, exceto os destrutivos bloqueados (formatar disco, `rm -rf /`, desligar…).
- Toda ação fica registrada na tabela `audit`.
- Para expor na rede (`JARVIS_HOST=0.0.0.0`), use apenas em rede confiável ou atrás de VPN.

# 🔒 Política de Segurança

Damos extrema importância à segurança e à privacidade dos dados no projeto **AssistentePessoal**. Como este ecossistema interage diretamente com o sistema operacional hospedeiro (host) e armazena credenciais locais criptografadas, adotamos uma postura proativa em relação a vulnerabilidades.

## Versões Suportadas

Apenas as versões listadas abaixo recebem atualizações de segurança ativas:

| Versão | Suportada |
| ------ | --------- |
| 1.0.x  | ✅ Sim     |
| < 1.0  | ❌ Não     |

## Como Reportar uma Vulnerabilidade

**Por favor, não abra uma Issue pública para relatar falhas de segurança.** 

Se você descobrir uma vulnerabilidade que possa comprometer a integridade do host, vazamento de chaves AES ou bypass de segurança, siga o protocolo abaixo:

1. Envie um e-mail detalhado para o mantenedor do repositório (ou configure o recurso de *Private Vulnerability Reporting* nas configurações de segurança deste repositório no GitHub).
2. Inclua uma descrição clara da falha e, se possível, um passo a passo para reproduzi-la (PoC).

Agradecemos o seu esforço em nos ajudar a manter o projeto seguro para todos os usuários!

Relate vulnerabilidades abrindo uma issue privada (Security advisories) no GitHub.

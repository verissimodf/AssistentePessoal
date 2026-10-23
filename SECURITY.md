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
| 1.7.x  | ✅ Sim     |
| 1.6.x  | ✅ Sim     |
| < 1.6  | ❌ Não     |

## Mitigação de Vulnerabilidades e Resolução de CVEs (Release v1.7.0)

### Tabela de Mitigação de Vulnerabilidades (7 CVEs Resolvidas)

| CVE | Vulnerabilidade / Vetor de Risco | Pacote Afetado | Versões Vulneráveis | Versão Travada / Mitigada | Mecanismo de Mitigação |
|---|---|---|---|---|---|
| **CVE-2024-45811** | DOM Clobbering via injeção HTML no servidor de desenvolvimento | `vite` | `<= 5.4.5` | `8.3.5` | `overrides.vite` |
| **CVE-2024-43788** | DOM Clobbering em assets e importações dinâmicas de bundles | `vite` | `<= 5.4.6` | `8.3.5` | `overrides.vite` |
| **CVE-2025-24964** | CSS Injection via manipulação de rotas de stylesheets | `vite` | `<= 6.0.8` | `8.3.5` | `overrides.vite` |
| **CVE-2024-34341** | Path Traversal fora da raiz via bypass de namespace `@fs` | `vite` | `< 5.2.11` | `8.3.5` | `overrides.vite` |
| **CVE-2024-34342** | Leitura arbitrária de arquivos (Arbitrary File Read) no dev server | `vite` / `rolldown` | `< 5.2.12` | `8.3.5` / `1.2.1` | `overrides.rolldown` + `overrides.vite` |
| **CVE-2024-45812** | Code Injection / Prototype Pollution no resolvedor de mocks | `@vitest/mocker` | `< 4.1.12` | `4.1.12` | `overrides["@vitest/mocker"]` |
| **CVE-2025-27592** | Sandbox Bypass no runner de módulos SSR em modo desenvolvimento | `vite` | `< 6.1.1` | `8.3.5` | `overrides.vite` |

**Evidência de Auditoria (`npm audit`):**
```text
$ npm audit
found 0 vulnerabilities
```


## Como Reportar uma Vulnerabilidade

**Por favor, não abra uma Issue pública para relatar falhas de segurança.** 

Se você descobrir uma vulnerabilidade que possa comprometer a integridade do host, vazamento de chaves AES ou bypass de segurança, siga o protocolo abaixo:

1. Envie um e-mail detalhado para o mantenedor do repositório (ou configure o recurso de *Private Vulnerability Reporting* nas configurações de segurança deste repositório no GitHub).
2. Inclua uma descrição clara da falha e, se possível, um passo a passo para reproduzi-la (PoC).

Agradecemos o seu esforço em nos ajudar a manter o projeto seguro para todos os usuários!

Relate vulnerabilidades abrindo uma issue privada (Security advisories) no GitHub.

## Autenticação e autorização (v1.1)
- Rotas públicas: apenas `GET /api/health`, `POST /api/auth/setup`, `POST /api/auth/login`. Todas as demais exigem sessão de administrador ou token de serviço com escopo.
- Sessão: cookie `HttpOnly; SameSite=Strict`, inatividade 30 min, máximo 12 h, rotação no login, revogação no servidor. Defina `JARVIS_COOKIE_SECURE=1` se servir o painel por HTTPS.
- CSRF: toda requisição `POST/PUT/PATCH/DELETE` com cookie exige `X-Jarvis-CSRF` vinculado à sessão (inclusive logout).
- Origem/CORS é defesa adicional, não autenticação.
- Aprovar ações no host e gerenciar administradores/sessões/tokens exige sessão humana; tokens de serviço nunca recebem esses poderes.
- Escopos de ferramentas são reavaliados no momento da execução (chat, MCP, bots, Telegram).
- Senhas: scrypt com sal; sessões, tokens e código de primeiro acesso são guardados só como hash SHA-256.
- Backup, rollback e recuperação de acesso: `docs/RECUPERACAO.md`.

## Correções da revisão (v1.1.1)
- Limite de tentativas: no modo local (127.0.0.1 / ::1) não há contador compartilhado por IP — só por par origem+conta (bloqueio após 5) e por conta (atraso máx. 60 s). Para origens remotas o contador por IP existe e é zerado após login válido.
- Bots: permissões explícitas por bot (`web`, `memories:read`, `memories:write`, `host:run`, `comms:read`, `comms:send`); nunca `*` nem escopos de administrador. Padrão: `web` + `memories:read`. Bots antigos sem dono continuam marcados `legacy_unowned` e, sem lista explícita, recebem só `web` + `memories:read` (política de compatibilidade).
- `cli_agent` (Claude Code, Codex, OpenCode, Hermes…) sempre exige aprovação humana, em qualquer autonomia.
- Migrações verificam contagem **e** conteúdo (SHA-256 de todas as linhas) das tabelas preservadas; qualquer diferença desfaz a migração.
- Upload: limite aplicado aos bytes realmente lidos, mesmo sem `Content-Length`.

## Endurecimento final da Fase 1 (v1.1.2)
- O curinga `*` e os escopos exclusivos de administrador só valem para uma identidade **emitida por `validateSession()`**. O módulo `server/auth.js` registra cada identidade emitida num `WeakMap` privado (chave = identidade do objeto, congelado) com uma verificação de vida que relê sessão e administrador no banco a cada `can()`. Um objeto forjado ou copiado — mesmo com `type: "admin"`, `adminId` e `scopes: ["*"]` idênticos — não está no registro e não recebe nada. Logout, inatividade, expiração absoluta e desativação do administrador removem o poder imediatamente.
- Identidades sem tipo conhecido (`service`, `bot`, `channel`) são negadas; principais com escopos malformados são negados.
- `createServiceToken()` exige sessão de administrador verificada e recusa com erros específicos: `wildcard_scope_forbidden`, `admin_scope_forbidden`, `unknown_scope`, `invalid_scopes`, `admin_session_required`.

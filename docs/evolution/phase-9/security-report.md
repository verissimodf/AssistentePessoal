# Relatório Final de Segurança — Fase 9

## Correções de segurança/robustez feitas na F9

### 1. Ciclo estático `bots.js` ↔ `jobs.js`
Único ciclo real do grafo de imports. Corrigido com runner injetado (`setBotRunner`)
e semântica FIRST-WINS — o primeiro binding vence, replicando o binding estático
antigo; reimports de teste não trocam o runner. Elimina risco de inicialização
ordem-dependente no boot. Estado final: **zero ciclos estáticos**.

### 2. Contrato de erro falso STT→mail
`server/stt.js` lançava `MailError` — um erro de STT era indistinguível de um erro de
mail no choke point. Criada `SttError` própria, preservando os códigos estáveis já
contratados. Nenhum consumidor externo quebrou (suíte integral verde).

### 3. Bug funcional de autorização de avaliação (F8)
`recordExternalEvent` avaliava só a primeira regra que casava: o cooldown de uma regra
bloqueava as irmãs do mesmo evento. Corrigido para avaliar **todas** as regras; teste
de regressão nº 36 em `tests/integrations.test.mjs`. Não era escalação de privilégio —
era falha de cobertura de avaliação que gerava comportamento ordem-dependente.

## Superfície pública

- **6 rotas públicas**, todas asseridas em `tests/http-auth.test.mjs`:
  `GET /api/health`, `GET /api/oauth/callback`, `POST /api/auth/login`,
  `POST /api/auth/setup`, `POST /api/if/webhooks/:producerId` (HMAC),
  `POST /api/integrations/agentmail/webhook` (Svix).
- **224 rotas com `access` declarado** no choke point único (`server/index.js`);
  todo não-público rejeita anônimo com 401 (asserção em loop no teste).
- OAuth callback **fail-closed** para state desconhecido e nunca devolve erros do provider.
- Origem não confiável é recusada mesmo em rotas públicas (asserido).

## Controles que permanecem intocados

| Controle | Garantia |
|---|---|
| SCOPES + deny-by-default | toda rota declara `access`; scopes re-checados em `callTool` no momento da execução (caminhos indiretos — MCP, bots, Telegram — não bypassam) |
| Ownership imutável | tabela `ownership` com trigger; filtros por `owner_admin_id` em todas as tabelas novas (`owns()` ou coluna na query) |
| D9 / Policy Engine | nativos e intocados; toda ação sensível passa por aprovação com fingerprint |
| Segredos | AES-256-GCM (`secret-crypto`); segredo de produtor de webhook exibido **1×** |
| Prompt injection | tratado como **dado** em todos os pontos de entrada (KH, research, webhook, mail) — cobertura por testes adversariais existentes (40+ casos adversariais distribuídos nas suítes) |
| Migrações | versionadas, backup verificado + transação única; registro legado nunca recebe owner automático |

## Scanners e testes adversariais

A F9 não introduziu scanner novo; a base adversarial existente das suítes (40+ casos
entre `security-hardening.test.mjs`, `kh-security.test.mjs`, `workforce-security.test.mjs`,
`wf-security.test.mjs`, `research-security.test.mjs`, `isolation.test.mjs`,
`bots-authz.test.mjs`, `urlpolicy*.test.mjs`, `hostpolicy.test.mjs`) foi executada
integralmente na regressão 848/848 — **0 falhas**.

## Segredos na auditoria

A auditoria de trilha confirmou que **nenhum segredo aparece em eventos de auditoria**
(asserido na demo-final-acceptance, passo "auditoria sem segredos").

## Riscos residuais

Nada CRITICAL/HIGH aberto. Riscos MEDIUM/LOW residuais com disposição em
[threat-model.md](threat-model.md) e [limitations.md](limitations.md).

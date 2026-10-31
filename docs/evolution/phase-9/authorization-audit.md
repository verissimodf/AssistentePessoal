# Auditoria de Autorização (D9 / Policy / Ownership) — Fase 9

## Invariantes auditadas

1. **Nada se auto-autoriza**: nem payload, nem evento externo, nem conteúdo de KH/research/mail
   concede permissão. Identidade vem sempre da credencial validada no backend (`validateSession()`).
2. **Choke point único**: toda rota declara `access` em `server/index.js`; só objetos
   emitidos por `validateSession()` são registrados como principals — objetos forjados
   não passam em `isVerifiedAdmin()`.
3. **Re-checagem no momento da execução**: scopes são verificados de novo dentro de
   `callTool`, então caminhos indiretos (MCP, bots, Telegram, scheduler) não bypassam
   as checagens de rota.
4. **Ownership explícito**: registros legados nunca recebem owner automático;
   `ownership` é imutável (trigger); todo módulo novo filtra por `owns()` ou
   `owner_admin_id` na query.

## Superfície pública (asserida)

`tests/http-auth.test.mjs` assexa, exatamente, as **6 rotas públicas**:

```
GET  /api/health
GET  /api/oauth/callback
POST /api/auth/login
POST /api/auth/setup
POST /api/if/webhooks/:producerId
POST /api/integrations/agentmail/webhook
```

E assexa que **todas as demais rotas (224 com `access` declarado)** rejeitam chamadas
anônimas com 401, em loop sobre a tabela de rotas — impossível "esquecer" uma rota
sem que o teste falhe.

Webhooks públicos são autenticados por HMAC-SHA256 (Integration Fabric) ou assinatura
Svix (AgentMail) — **a assinatura autentica o produtor; não autoriza ação alguma**.

## Cobertura por mecanismo

| Mecanismo | Onde | Cobertura de teste |
|---|---|---|
| SCOPES / deny-by-default | `server/auth.js` + choke point | `auth.test.mjs`, `http-auth.test.mjs`, `bots-authz.test.mjs` |
| Ownership | `server/ownership.js` + filtros por módulo | `isolation.test.mjs` + passos de isolamento cross-owner da demo final em **todos os módulos** |
| Policy Engine | `server/policies.js` | `policies.test.mjs` |
| D9 (aprovação humana nativa) | `browser-approval.js` + `resolveApproval` + fingerprint | `d-rec-invariants.test.mjs`, `approvals-actions.test.mjs`, `approval-correlation*.test.mjs` |
| Re-checagem em `callTool` | `server/tools.js` | `agent-loop-e2e.test.mjs`, `mcp.test.mjs` |
| Egress/URL policy | `urlpolicy.js`, `browser-egress-policy.js` | `urlpolicy.test.mjs`, `urlpolicy-crawl.test.mjs`, `browser-egress-proxy.test.mjs` |
| Host commands | `server/hostpolicy.js` | `hostpolicy.test.mjs` |

## Isolamento cross-owner (demo de aceite)

A demo-final-acceptance verifica, módulo a módulo, que recursos de um admin não são
visíveis nem operáveis por outro — incluindo os módulos novos das fases 5–8
(proactive, integrations, calendar, multimodal, computer, workflow) — e termina com
**0 execuções não autorizadas** no audit.

## Descobertas da F9

- Nenhuma rota nova foi adicionada; nenhuma rota mudou de `access`.
- A correção do avaliador de regras (`recordExternalEvent` — todas as irmãs) **amplia**
  a cobertura de avaliação sem alterar autorização: regras continuam limitadas ao
  owner e à execução via Workflow/D9.
- Migração v28 é aditiva (índices) — nenhum dado ou permissão alterada.

## Conclusão

As invariantes de autorização da base (SCOPES, ownership, D9, choke point) seguem
**intactas e asseridas por testes** após a consolidação. Evidências por módulo na
matriz [integration-matrix.md](integration-matrix.md).

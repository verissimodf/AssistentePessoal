# D_REC — Recuperação de acesso, titularidade e expurgo (auditoria técnica e decisão pendente)

**Status: proposta técnica. Nenhuma operação destrutiva implementada.** Aguarda decisão explícita.
Complementa a política em `docs/RECUPERACAO.md` §D_REC e serve de referência para a Fase 4.
Base auditada: `main` = `c4b05a0`.

## 1. Resumo

Recuperação de acesso, transferência de titularidade e expurgo são operações **distintas**.
Hoje estão implementadas apenas: (a) a recuperação local de credenciais (break-glass), (b) o isolamento
por titularidade (Fase 2) e (c) a reivindicação explícita de recursos **sem dono comprovável**.
**Não** existe transferência de recursos de administrador **desativado**, nem expurgo.
Esta especificação registra o estado real e as decisões que faltam — sem implementar nada destrutivo.

## 2. Evidências da arquitetura (verificadas no código)

| Item | Evidência (arquivo) |
|---|---|
| Esquema | Migrações **v1** (auth), **v2** (ownership/settings/legacy), **v3** (documents) em `server/migrations.js` |
| Titularidade | Tabela `ownership` — PK `(resource_type, resource_id)`, `owner_admin_id` FK→`admins`, `origin IN ('created','migrated','claimed')`; índice `idx_ownership_owner`; **trigger `trg_ownership_immutable` BEFORE UPDATE → ABORT** |
| Tipos de recurso | `memory, agent, bot, run, approval` (v2) + `document` (v3) — `CHECK` no `ownership` |
| Histórico de reivindicação | `legacy_claims(id, resource_type, resource_id, admin_id, at)` — só para recursos **sem dono** |
| Autenticação | `server/auth.js`: sessão (cookie HttpOnly/SameSite=Strict, CSRF), `validateSession` exige admin **ativo**; `removeAdmin` revoga sessões+tokens do alvo e faz `active=0` |
| CSRF | `x-jarvis-csrf` vinculado à sessão, exigido em métodos mutantes (inclusive logout) |
| Auditoria | `server/db.js`: `sanitizeAudit` com **allowlists fechadas** (`AUDIT_FIELDS`, `AUDIT_REASONS`, `AUDIT_AGENTS`, regex `CODE`); chaves desconhecidas descartadas (`dropped`) |
| Rotas relevantes | `GET /api/legacy` (metadados), `POST /api/legacy/claim` (`session`), `DELETE /api/auth/admins/:id` (`session`), `GET /api/audit` (`audit:read`) |
| Recursos base | `memories, agents, bots, runs, approvals, documents` + `ownership` |
| Testes | `tests/isolation.test.mjs`, `migration-v2.test.mjs`, `auth.test.mjs`, `audit-probe.test.mjs`, `phase2-fixes.test.mjs`, e o novo `tests/d-rec.test.mjs` |

## 3. Comportamento atual (implementado)

- **Recuperação de credenciais (break-glass local):** `server/recuperar-acesso.js` — exige serviço parado
  e acesso ao host; backup verificado; desativa todos os admins, revoga sessões/tokens e recria o primeiro
  acesso. **Não** altera `ownership` nem dados de recursos.
- **Isolamento:** toda consulta/escrita filtra por `principal.adminId`; recursos sem dono ficam invisíveis.
- **Reivindicação de recursos sem dono:** `POST /api/legacy/claim`, `session`, confirmação `ASSUMIR`,
  **atômica** (todos os ids válidos ou nada), grava `origin='claimed'` e audita `legacy.claimed`;
  aprovações órfãs pendentes são invalidadas (`legacy_expired`).
- **Recursos de administrador desativado:** permanecem com o dono inativo; **invisíveis** e
  **não reivindicáveis** (não aparecem na triagem; `claimLegacy` recusa `already_owned`).
- **Auditoria:** sanitizada por allowlist; nunca grava conteúdo, tokens, senhas ou caminhos.

## 4. Estado de implementação

**Implementado (2026-10-15):**
- Transferência **explícita, granular, atômica e auditada** de recursos de administrador desativado
  (`server/ownership.js::transferResources`), exigindo **reautenticação recente** vinculada à sessão
  (`server/auth.js::reauth`/`hasRecentReauth`, migração v4 `sessions.reauth_at`) e gravando histórico
  append-only (`ownership_history`). Rotas `session`: `POST /api/ownership/transfer`,
  `POST /api/auth/reauth`, `GET /api/ownership/inactive` (metadados apenas).
  O admin de origem **não** é reativado; nada é transferido automaticamente; a imutabilidade de
  `ownership` é respeitada (remoção + reinserção com `origin='transferred'`).

**Não implementado (bloqueado até decisão):**
- Expurgo (exclusão permanente) — depende da política de retenção (D_REC-2) e de estratégia em etapas;
  dependências: embeddings, arquivos em `data/documents/<adminId>/`, índices.
- Reativação/realocação de credenciais de e-mail ou integrações (Fase 4).

## 5. Decisões pendentes

### D_REC-1 — Reivindicar recursos de administrador desativado?
| Alternativa | Prós | Contras | Risco |
|---|---|---|---|
| (a) Manter bloqueado (status quo) | nenhum risco de vazamento; simples | recursos ficam inacessíveis para sempre | baixo |
| (b) Transferência **explícita, granular, auditada** por um admin ativo | recupera dados legítimos | exige histórico, concorrência segura e UI | médio |
| (c) Reativação do admin inativo como atalho | — | confunde recuperação com transferência | **alto (proibido)** |

**Recomendação:** (b), **se e quando** aprovada, com os invariantes da §7 — **nunca** (c).

### D_REC-2 — Expurgo
| Alternativa | Prós | Contras |
|---|---|---|
| (a) Não expurgar (status quo) | seguro | disco cresce |
| (b) Expurgo em etapas com estado persistente | retomável, idempotente | complexidade; SQLite≠FS |

**Recomendação:** (b) somente após aprovação explícita; **não** prometer atomicidade entre SQLite e
sistema de arquivos.

### D_REC-3 — Reautenticação para operações sensíveis
**Recomendação:** exigir reautenticação recente vinculada à sessão verificada (revalidada no momento da
operação) para transferência/expurgo — **não** aceitar indicador enviado pelo cliente.

### D_REC-4 — Preservação na triagem
**Recomendação:** inventários exibem apenas metadados (id, data, tipo); **sem** conteúdo.

## 6. Testes (não destrutivos) — `tests/d-rec.test.mjs`

Verificam o comportamento **atual** (sem transferir/expurgar):
1. Desativação mantém a titularidade (**sem transferência automática**) e revoga sessão e token do admin.
2. Recursos do admin inativo ficam **invisíveis** (lista/busca/edição/exclusão 404) e **não reivindicáveis**
   (fora da triagem; `claim` → 409 `already_owned`).
3. Sonda `TOKEN_SECRETO_SONDA` no conteúdo **não** aparece na tabela `audit` nem na API `/api/audit`.

## 7. Critérios de aceite (para quando D_REC for aprovada)

- Recuperar acesso **não** concede titularidade; criar conta **não** transfere recursos.
- Recursos de admin desativado permanecem bloqueados até procedimento aprovado **e implementado**.
- Transferência (se aprovada): admin ativo autenticado; por tipo/ids; lote limitado; sem duplicados/terceiros;
  **atômica**; auditada sem conteúdo; segura sob concorrência; respeita `trg_ownership_immutable`
  (se exigir remoção+reinserção, com **histórico** e integridade referencial demonstradas).
- Expurgo (se aprovado): isolamento antes da limpeza; remoção/invalidação de derivados; estado persistente;
  idempotente; **sem** apagar arquivos por caminho fornecido pelo cliente.
- Auditoria sempre sanitizada (sem segredo/conteúdo/caminho).
- Transferência de recurso de e-mail **não** reativa credenciais/tokens/sessões/aprovações automaticamente.

## 8. Recomendação

**Manter o bloqueio** de transferência/expurgo até decisão explícita (D_REC-1/D_REC-2). Nesta tarefa **não**
se implementa nada destrutivo. O artefato entregue é a auditoria técnica + testes não destrutivos +
esta especificação, para aprovação pelo responsável.

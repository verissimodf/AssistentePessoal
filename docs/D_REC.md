# D_REC — Recuperação de acesso, titularidade e expurgo (auditoria técnica e decisão pendente)

**Status: D_REC-1 (transferência), D_REC-3 (reautenticação), D_REC-4 (triagem) e D_REC-2 (expurgo
**exclusivamente manual**) implementados.** Nenhuma execução real sobre dados reais; o mecanismo de
expurgo exige autorização explícita por operação e escopo.
Complementa a política em `docs/RECUPERACAO.md` §D_REC e serve de referência para a Fase 4.
Base auditada: `main` = `563978f`.

## 1. Resumo

Recuperação de acesso, transferência de titularidade e expurgo são operações **distintas**.
Hoje estão implementadas: (a) a recuperação local de credenciais (break-glass), (b) o isolamento
por titularidade (Fase 2), (c) a reivindicação explícita de recursos **sem dono comprovável**,
(d) a transferência **explícita** de recursos de administrador desativado (D_REC-1) e
(e) o expurgo **exclusivamente manual**, em etapas (D_REC-2). Este documento registra o estado real,
as decisões tomadas e o que permanece pendente.

## 2. Evidências da arquitetura (verificadas no código)

| Item | Evidência (arquivo) |
|---|---|
| Esquema | Migrações **v1** (auth), **v2** (ownership/settings/legacy), **v3** (documents), **v4** (reauth/histórico), **v5** (purge) em `server/migrations.js` |
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
- **Expurgo (D_REC-2, exclusivamente manual):** `POST /api/ownership/purge` (`session`, reautenticação
  recente + confirmação `EXPURGAR`) cria um *job* em etapas (quarentena → remoção item a item),
  **retomável** (`POST /api/ownership/purge/:id/resume`) e **idempotente**; `POST
  /api/ownership/purge/:id/cancel` libera a quarentena **somente** se nada foi removido. Elegibilidade:
  recurso com dono **inativo** (titularidade clara). Recursos **sem dono** (legado) são **preservados**
  (titularidade ambígua; ainda reivindicáveis). **Não** há exclusão automática por idade nem prazo de
  retenção. `GET /api/ownership/purge` lista apenas metadados.
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

**Implementado (2026-10-15) — D_REC-2 (expurgo exclusivamente manual):**
- Fluxo explícito de solicitação + confirmação (`confirm: "EXPURGAR"`), autorização no servidor
  (`session` + reautenticação recente vinculada à sessão) e validação de escopo (tipo/ids/duplicados).
- Job em **etapas**: `quarentena` (isolamento imediato — bloqueia transferência do recurso) →
  `remoção` item a item. **Retomável** (estado por item em `purge_items`) e **idempotente**
  (reexecução não remove duas vezes). Migração **v5** (`purge_jobs`, `purge_items`, `purge_quarantine`).
- Tratamento de falhas: erro por item é registrado (`purge_items.error`) sem abortar o lote; job fica
  `error` e pode ser retomado. **Não** se promete atomicidade entre SQLite e o sistema de arquivos:
  arquivos de `documents` são removidos *best-effort* após a linha.
- Cancelamento seguro (`cancelPurge`): só quando **nada** foi removido; libera a quarentena e apaga o
  job (auditado). Expurgo parcialmente executado **não** é cancelável — deve ser retomado (evita estado
  meio-expurgado com quarentena obsoleta).
- **Elegibilidade:** dono **inativo** apenas. **Sem dono/legado → preservado** (titularidade ambígua).
  **Sem** prazos de retenção e **sem** exclusão automática por idade.

**Não implementado (bloqueado até decisão):**
- Reativação/realocação de credenciais de e-mail ou integrações (Fase 4).
- Interface (UI) de expurgo — a API é o contrato; a UI é follow-up opcional.

## 5. Decisões pendentes

### D_REC-1 — Reivindicar recursos de administrador desativado?
| Alternativa | Prós | Contras | Risco |
|---|---|---|---|
| (a) Manter bloqueado (status quo) | nenhum risco de vazamento; simples | recursos ficam inacessíveis para sempre | baixo |
| (b) Transferência **explícita, granular, auditada** por um admin ativo | recupera dados legítimos | exige histórico, concorrência segura e UI | médio |
| (c) Reativação do admin inativo como atalho | — | confunde recuperação com transferência | **alto (proibido)** |

**Recomendação:** (b), **se e quando** aprovada, com os invariantes da §7 — **nunca** (c).

### D_REC-2 — Expurgo
**Decisão: (b) expurgo em etapas, **exclusivamente manual** — implementado.** Sem prazos de retenção e
**sem** exclusão automática por idade. Estado persistente (`purge_jobs`/`purge_items`), retomável e
idempotente; **não** se promete atomicidade entre SQLite e sistema de arquivos. A autorização para
desenvolver o mecanismo **não** autoriza sua execução sobre dados reais: cada operação real exige
autorização explícita específica (operador + escopo).

| Alternativa | Prós | Contras |
|---|---|---|
| (a) Não expurgar (status quo) | seguro | disco cresce |
| (b) Expurgo em etapas, **manual**, com estado persistente | retomável, idempotente, preserva ambíguos | complexidade; SQLite≠FS |
| (c) Expurgo automático por idade | — | **proibido** (inventa retenção; risco de perda) |

### D_REC-3 — Reautenticação para operações sensíveis
**Recomendação:** exigir reautenticação recente vinculada à sessão verificada (revalidada no momento da
operação) para transferência/expurgo — **não** aceitar indicador enviado pelo cliente.

### D_REC-4 — Preservação na triagem
**Recomendação:** inventários exibem apenas metadados (id, data, tipo); **sem** conteúdo.

## 6. Testes (não destrutivos) — `tests/d-rec.test.mjs`, `d-rec-transfer.test.mjs`, `d-rec-invariants.test.mjs`, `d-rec-purge.test.mjs`

Verificam o comportamento **atual** (sem operar sobre dados reais):
1. Desativação mantém a titularidade (**sem transferência automática**) e revoga sessão e token do admin.
2. Recursos do admin inativo ficam **invisíveis** (lista/busca/edição/exclusão 404) e **não reivindicáveis**
   (fora da triagem; `claim` → 409 `already_owned`).
3. Sonda `TOKEN_SECRETO_SONDA` no conteúdo **não** aparece na tabela `audit` nem na API `/api/audit`.
4. `d-rec-purge.test.mjs`: reautenticação/confirmação obrigatórias; inelegíveis recusados (fonte ativa,
   terceiro, sem dono, inexistente) **sem criar job**; expurgo manual remove linha+titularidade, grava
   quarentena e auditoria **sem conteúdo**; token de serviço recusado (`session`); repetição recusada;
   falha parcial **retomável** e **idempotente**; quarentena **bloqueia transferência** até retomar;
   cancelamento só quando nada foi removido; arquivo de `documents` removido; listagem só com metadados.

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

**Manter a exigência de autorização explícita por operação** para transferência/expurgo reais. Nesta
tarefa implementou-se o **mecanismo** (D_REC-2 manual), com testes não destrutivos e especificação —
**sem** operar sobre dados reais. Qualquer execução real (transferir ou expurgar) continua exigindo
autorização explícita específica do responsável, com operador e escopo identificados.

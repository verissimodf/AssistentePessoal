# D_REC — Recuperação de acesso, titularidade e expurgo (auditoria técnica e decisões)

**Status: D_REC-1 (transferência de recursos), D_REC-1a (transferência explícita de contas de e-mail),
D_REC-3 (reautenticação), D_REC-4 (triagem) e D_REC-2 (expurgo **exclusivamente manual**) implementados.**
Nenhuma execução real sobre dados reais; o mecanismo de expurgo e a transferência de conta de e-mail
exigem autorização explícita por operação e escopo.
Complementa a política em `docs/RECUPERACAO.md` §D_REC e serve de referência para a Fase 4.
Base auditada: `main` = `f563af5`; decisão de titularidade de e-mail registrada em 2026-10-19
(`docs/FASE-4-EMAIL.md` §11.3).

## 1. Resumo

Recuperação de acesso, transferência de titularidade e expurgo são operações **distintas**.
Hoje estão implementadas: (a) a recuperação local de credenciais (break-glass), (b) o isolamento
por titularidade (Fase 2), (c) a reivindicação explícita de recursos **sem dono comprovável**,
(d) a transferência **explícita** de recursos de administrador desativado (D_REC-1),
(e) o expurgo **exclusivamente manual**, em etapas (D_REC-2), e
(f) a transferência **explícita, auditada e sem reativação** de contas de e-mail de administrador
desativado (D_REC-1a, Fase 4). Este documento registra o estado real, as decisões tomadas e o que
permanece pendente.

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
| Contas de e-mail | `admin_settings` (configuração pessoal cifrada); titularidade implícita pelo `admin_id`; **não** são linhas de `ownership` |
| Transferência de e-mail (D_REC-1a) | `server/settings.js::transferMailAccount`; rota `POST /api/ownership/mail/transfer` (`session` + reautenticação); `ownership_history` com `resource_type='mail_account'` |
| Testes | `tests/isolation.test.mjs`, `migration-v2.test.mjs`, `auth.test.mjs`, `audit-probe.test.mjs`, `phase2-fixes.test.mjs`, `tests/d-rec.test.mjs`, `tests/d-rec-transfer.test.mjs`, `tests/d-rec-purge.test.mjs` e `tests/mail-ownership.test.mjs` |

## 3. Comportamento atual (implementado)

- **Recuperação de credenciais (break-glass local):** `server/recuperar-acesso.js` — exige serviço parado
  e acesso ao host; backup verificado; desativa todos os admins, revoga sessões/tokens e recria o primeiro
  acesso. **Não** altera `ownership` nem dados de recursos. **Não** altera `admin_settings`: contas de
  e-mail permanecem com o titular original.
- **Contas de e-mail — padrão:** após desativação ou recuperação, a conta permanece em `admin_settings`
  do titular original; outro admin recebe `404 account_not_found`. Não há transferência/reativação
  automática.
- **Contas de e-mail — exceção explícita (D_REC-1a):** somente `POST /api/ownership/mail/transfer`
  (`session` + reautenticação recente + `confirm: "TRANSFERIR CONTA"`), uma conta `gmail`/`outlook`,
  origem inativa e destino ativo. Move o bloco cifrado, remove da origem e grava a cópia no destino com
  `enabled=false`/`state="reconnect"`; conflito no destino é recusado; auditoria e histórico só com
  metadados. **Não** conecta, ativa transporte real ou envia.
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

**Implementado (2026-10-19) — D_REC-1a (contas de e-mail, Fase 4):**
- Decisão de produto em `docs/FASE-4-EMAIL.md` §11.3: **Padrão A** (manter com o titular original;
  sem transferência/reativação automática) + **exceção B** (transferência explícita e auditada).
- `server/settings.js::transferMailAccount`: transação `BEGIN IMMEDIATE`, escopo de uma conta
  (`gmail`/`outlook`), origem inativa, destino ativo, conflito no destino recusado (`target_account_exists`),
  movimento do bloco **cifrado** e remoção da origem no mesmo commit.
- O destino recebe `enabled=false`/`state="reconnect"`; a operação **não** reativa credenciais nem
  ativa o transporte. Auditoria `mail.account_transferred` + `ownership_history` com
  `resource_type='mail_account'`, sem usuário/senha/conteúdo.
- Testes: `tests/mail-ownership.test.mjs` (7 casos), incluindo desativação, recuperação break-glass,
  concorrência/repetição, conflito, reautenticação e token de serviço.

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

**Não implementado (fora do escopo desta entrega):**
- Reativação ou transferência **automática** de credenciais de e-mail/integrações — proibida. A
  transferência **explícita** de contas de e-mail está implementada (D_REC-1a), mas **não** autoriza
  operação real, conexão, transporte IMAP/SMTP ou envio.
- UI dedicada para transferência de conta de e-mail — a API é o contrato; UI é follow-up opcional.
- Interface (UI) de expurgo — a API é o contrato; a UI é follow-up opcional.

## 5. Decisões (histórico e estado)

### D_REC-1 — Reivindicar recursos de administrador desativado?
| Alternativa | Prós | Contras | Risco |
|---|---|---|---|
| (a) Manter bloqueado (status quo) | nenhum risco de vazamento; simples | recursos ficam inacessíveis para sempre | baixo |
| (b) Transferência **explícita, granular, auditada** por um admin ativo | recupera dados legítimos | exige histórico, concorrência segura e UI | médio |
| (c) Reativação do admin inativo como atalho | — | confunde recuperação com transferência | **alto (proibido)** |

**Recomendação:** (b), **se e quando** aprovada, com os invariantes da §7 — **nunca** (c).

### D_REC-1a — Contas de e-mail de administrador desativado — **decidida (2026-10-19)**

**Decisão de produto (Fase 4, `docs/FASE-4-EMAIL.md` §11.3):** adotar **Padrão A + exceção B**.

- **A — padrão:** a conta permanece com o titular original após desativação ou recuperação; sem
  transferência, reivindicação ou reativação automática. `removeAdmin` e `recuperar-acesso.js` não
  alteram `admin_settings`.
- **B — exceção:** transferência somente por operação explícita e auditada, com reautenticação recente,
  validação de titularidade/escopo, sem conflito no destino e proteção contra concorrência/repetição.
  A conta movida fica **desativada** (`enabled=false`) e exige validação/habilitação explícita do destino.
- **Escopo da decisão:** mecanismo local para `gmail`/`outlook`; **não** autoriza conta real, conexão,
  `JARVIS_MAIL_TRANSPORT=imap`, envio, UI dedicada ou ampliação para integrações.
- **Auditoria:** `mail.account_transferred` + `ownership_history` (`resource_type='mail_account'`) apenas
  com metadados; nunca usuário, senha, corpo ou conteúdo.
- **Relação com D_REC-1:** a conta **não** é recurso da tabela `ownership`; a transferência usa o mesmo
  padrão de autorização/atomicidade, mas um contrato próprio.

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

## 6. Testes (não destrutivos) — `tests/d-rec.test.mjs`, `d-rec-transfer.test.mjs`, `d-rec-invariants.test.mjs`, `d-rec-purge.test.mjs`, `mail-ownership.test.mjs`

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
5. `mail-ownership.test.mjs`: desativação e recuperação break-glass **não** transferem a conta; origem
   ativa/escopo inválido são recusados; reautenticação e confirmação literal são obrigatórias; a
   transferência move só a conta escolhida, mantém a credencial cifrada, grava `enabled=false` e **não**
   reativa; conflito no destino não sobrescreve; concorrência/repetição não duplica; token de serviço é
   recusado; auditoria/histórico não contêm usuário, senha ou conteúdo.

## 7. Critérios de aceite (mecanismos implementados)

- Recuperar acesso **não** concede titularidade; criar conta **não** transfere recursos.
- Recursos de admin desativado permanecem bloqueados até procedimento aprovado **e implementado**.
- Transferência (se aprovada): admin ativo autenticado; por tipo/ids; lote limitado; sem duplicados/terceiros;
  **atômica**; auditada sem conteúdo; segura sob concorrência; respeita `trg_ownership_immutable`
  (se exigir remoção+reinserção, com **histórico** e integridade referencial demonstradas).
- Expurgo (se aprovado): isolamento antes da limpeza; remoção/invalidação de derivados; estado persistente;
  idempotente; **sem** apagar arquivos por caminho fornecido pelo cliente.
- Auditoria sempre sanitizada (sem segredo/conteúdo/caminho).
- Transferência de recurso de e-mail **não** reativa credenciais/tokens/sessões/aprovações automaticamente.
- D_REC-1a: conta de e-mail só se move por operação explícita, com reautenticação recente, origem
  inativa, destino ativo, escopo `gmail`/`outlook`, sem conflito no destino e sem duplicação sob
  concorrência/repetição; o destino recebe `enabled=false`; resposta/auditoria/histórico só com metadados.

## 8. Recomendação

**Manter a exigência de autorização explícita por operação** para transferência/expurgo reais. Nesta
tarefa implementou-se o **mecanismo** (D_REC-2 manual e D_REC-1a de contas de e-mail), com testes não
destrutivos e especificação — **sem** operar sobre dados reais. Qualquer execução real (transferir uma
conta ou expurgar) continua exigindo autorização explícita específica do responsável, com operador e
escopo identificados. A decisão de titularidade **não** autoriza conectar conta, ativar
`JARVIS_MAIL_TRANSPORT=imap` nem enviar mensagens.

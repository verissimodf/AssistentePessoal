# ADR-001 — Identidade de sistema e primeiro acesso (Gate F)

**Data:** 2026-10-25
**Status:** **NEEDS-PRODUCT-DECISION** — design da Opção A provado em isolamento; falta decidir
entre “zero contas autenticáveis” (A) e “zero linhas” (A'/B).
**Baseline:** `origin/main` = `8bed8524d34c8f70a022f34d24647153d4622e66` (PR #72)
**Produção:** `assistente-pessoal:57eb38c` (`sha256:d6990cd22130…`), 1.7.6, `healthy`, `restarts=0`
**Nada foi alterado em produção.** Nenhuma conta removida, desativada, renomeada ou com senha
redefinida. Nenhuma migração aplicada.

---

## 1. Contexto

O Gate F do G9 exige: zero contas antigas cadastradas ou autenticáveis, zero sessões/tokens
válidos, `setupRequired=true` e a tela oficial de primeiro acesso.

A tentativa de execução direta (relatada em `docs/ENTREGA-G9-2026-10-25.md`) falhou em três
controles de integridade. Este ADR formaliza o conflito, especifica as opções e apresenta a prova
isolada da opção recomendada.

### Evidências usadas (SHA e caminhos)

| Evidência | Origem |
|---|---|
| Triggers e FKs | `data/jarvis.db` (schema lido em modo `ro`), `server/migrations.js` |
| Migrações versionadas e checagem de dados preservados | `server/migrations.js:11` (`PRESERVED`), `:522` (`migrate`) |
| Bootstrap / `setupRequired` / login | `server/auth.js:107-150`, `:231` |
| Rotas e health | `server/index.js:216` |
| Bloqueio reproduzido | `docs/ENTREGA-G9-2026-10-25.md` §7.2 |
| Backup usado na prova | `/opt/laytech-ai/backups/g9-pre-deploy-20261025T051816Z` |

---

## 2. Problema formalizado

### 2.1 Fatos reproduzidos (executados, não inferidos)

| # | Fato | Comando/erro |
|---|---|---|
| F1 | `ownership` não aceita `UPDATE` | `trg_ownership_immutable` → `ownership_immutable` |
| F2 | `admin_settings.admin_id` é PK | repontar 3 linhas → `UNIQUE constraint failed` |
| F3 | FKs `NO ACTION` de 9 tabelas para `admins` | `DELETE FROM admins` → `FOREIGN KEY constraint failed` |
| F4 | Triggers impedem zerar o último admin ativo | `trg_admins_protect_last_delete` / `_disable` |
| F5 | `ownership` **aceita** `DELETE` (só UPDATE é bloqueado) | trigger é `BEFORE UPDATE` |
| F6 | `admins` **não** está em `PRESERVED`; `memories`, `agents`, `approvals`, `audit` estão | `server/migrations.js:11` |
| F7 | `setupRequired = COUNT(admins WHERE active=1) === 0`; login exige `active=1` | `server/auth.js:108`, `:231` |
| F8 | O backup só restaura com `master.key` | `docs/BACKUP-E-RESTAURACAO.md` |

### 2.2 Consequências diretas

- Repontar propriedade é **impossível** (F1); apagá-la **órfã** agentes/memórias/aprovações (F5).
- Apagar contas exige apagar `ownership`, `conversations`, `admin_settings` e `legacy_claims`
  (F3) — perda de dados e de vínculo de propriedade.
- O produto foi desenhado para **nunca** ficar sem administrador ativo (F4).

### 2.3 Requisitos de produto **não decididos**

| # | Questão | Por que bloqueia |
|---|---|---|
| Q1 | “Zero contas” significa **zero linhas** em `admins` ou **zero identidades autenticáveis**? | define A vs A'/B |
| Q2 | O vínculo histórico de propriedade (agente → admin que o criou) precisa sobreviver? | se não, A' fica viável |
| Q3 | Conversas e settings do admin antigo devem ser preservados ou descartados? | B destrói; A preserva |
| Q4 | As linhas aposentadas devem aparecer na UI administrativa? | define filtro em `listAdmins` |

---

## 3. Restrições que qualquer solução deve respeitar

1. `PRESERVED` (`kv`, `memories`, `agents`, `bots`, `runs`, `approvals`, `audit`) não pode mudar
   conteúdo durante uma migração — o framework aborta e faz rollback.
2. `ownership` é imutável por trigger; qualquer reescrita exige remover o trigger **dentro** da
   transação e recriá-lo (alteração deliberada, com auditoria).
3. `admins` é referenciado por 9 tabelas com `NO ACTION` — apagar linhas exige tratar todas.
4. O bootstrap é de uso único, com token em arquivo `600` e TTL; `setupFirstAdmin` é atômico.
5. Nenhuma conta pode autenticar sem `active=1` (F7).

---

## 4. Opções

### Opção A — aposentar a conta mantendo a linha como âncora de dados (recomendada)

**Ideia:** a linha em `admins` deixa de ser uma *conta* e passa a ser apenas a **âncora de
propriedade** que as FKs exigem. Nenhuma FK é reescrita, nenhum trigger de `ownership` é tocado.

**Procedimento (transação única):**

```sql
BEGIN IMMEDIATE;
DROP TRIGGER IF EXISTS trg_admins_protect_last_delete;
DROP TRIGGER IF EXISTS trg_admins_protect_last_disable;

-- aposenta TODAS as linhas: inativa, renomeia e invalida o hash
UPDATE admins
   SET active = 0,
       username = '__retired__' || id,
       password_hash = '!retired'
 WHERE password_hash <> '!retired' OR active = 1 OR username NOT LIKE '__retired__%';

DELETE FROM sessions;          -- invalida sessões antigas
DELETE FROM service_tokens;    -- invalida tokens antigos

CREATE TRIGGER trg_admins_protect_last_delete BEFORE DELETE ON admins
WHEN OLD.active = 1 AND (SELECT COUNT(*) FROM admins WHERE active = 1) <= 1
BEGIN SELECT RAISE(ABORT, 'last_admin_protected'); END;
CREATE TRIGGER trg_admins_protect_last_disable BEFORE UPDATE OF active ON admins
WHEN OLD.active = 1 AND NEW.active = 0 AND (SELECT COUNT(*) FROM admins WHERE active = 1) <= 1
BEGIN SELECT RAISE(ABORT, 'last_admin_protected'); END;
COMMIT;
```

Depois: registrar `auth.accounts_retired` na auditoria (apenas contagens) e reiniciar o serviço —
`ensureBootstrap()` cria o token de primeiro acesso porque `adminCount()===0`.

**Propriedades:**

| Requisito | Como é atendido |
|---|---|
| Zero identidades autenticáveis | `active=0` (login filtra) **e** hash `!retired` (dupla barreira) |
| `setupRequired=true` | `adminCount()` conta `active=1` → 0 |
| Sessões/tokens | `DELETE` (filhos; FK não bloqueia) |
| Propriedade/agentes/memórias/aprovações | **intocados** (`ownership` não é tocado) |
| Conversas e settings | **intocados** (FKs preservadas) |
| Auditoria | preservada + 1 evento novo |
| Integridade | nenhuma FK reescrita; nenhum trigger de ownership removido |
| Reversibilidade | restaurar backup (banco + `master.key`) |

**Custo:** as 7 linhas permanecem como âncoras, invisíveis para autenticação. `listAdmins` deve
filtrar `active=1` (ou exibir como “aposentado”) — decisão Q4.

**Por que não é “só desativação”** (o que o G9 proibia): a senha é **invalidada** (`!retired`) e o
username é reescrito; não há como reativar sem uma operação administrativa explícita, e o hash
original deixa de existir no banco.

### Opção A' — remoção física com reescrita de propriedade

Requer, na mesma transação: remover `trg_ownership_immutable`, repontar `ownership` e
`ownership_history` para um principal de sistema, consolidar `admin_settings` (PK impede —
exige tabela de arquivo), tratar `legacy_claims`/`legacy_settings`, remover o trigger de proteção
do último admin e só então apagar as linhas.

- **Vantagem:** zero linhas em `admins`.
- **Custo:** altera controles de integridade (imutabilidade), reescreve dados de propriedade,
  exige novo schema (`admin_settings_archive`, coluna de principal), migração maior e risco de
  perda silenciosa de vínculo.
- **Status:** não implementada; viável apenas se Q2 = “não precisa preservar o vínculo”.

### Opção B — reset com perda de dados

Apagar `ownership` (16), `conversations` (11) + `conversation_messages` (27), `admin_settings` (3),
`legacy_claims` (8) e as contas. Auditoria preservada (sem FK).

- **Vantagem:** estado limpo, zero linhas.
- **Custo:** perda de agentes, memórias, aprovações, conversas e settings; irreversível fora do
  backup.
- **Status:** não implementada; exige autorização formal de perda de dados.

---

## 5. Comparação

| Critério | A | A' | B |
|---|---|---|---|
| Zero identidades autenticáveis | ✅ | ✅ | ✅ |
| Zero linhas em `admins` | ❌ (7 âncoras) | ✅ | ✅ |
| Preserva propriedade/agentes/memórias | ✅ | ⚠️ reescrita | ❌ |
| Preserva conversas/settings | ✅ | ⚠️ parcial | ❌ |
| Remove controles de integridade | não | sim (imutabilidade) | sim |
| Tamanho da mudança | ~30 linhas de script | migração + schema novo | migração + perda |
| Risco de perda silenciosa | baixo | médio | alto |
| Reversível por backup | ✅ | ✅ | ✅ |

---

## 6. Prova isolada da Opção A (executada)

Cópia descartável do backup `g9-pre-deploy-20261025T051816Z` (banco + `master.key`), container
isolado, porta efêmera. Produção não foi tocada.

### 6.1 Integridade e preservação

| Métrica | Antes | Depois |
|---|---|---|
| `admins` (total / ativos) | 7 / 1 | 7 / **0** |
| `sessions` | 58 | **0** |
| `service_tokens` | 6 | **0** |
| `ownership` | 16 | **16** |
| `conversations` | 11 | **11** |
| `agents` / `memories` | 4 / 4 | **4 / 4** |
| `audit` | 264 | **264** |
| hashes inválidos (`!retired`) | 0 | **7** |
| `PRAGMA integrity_check` | ok | **ok** |
| `PRAGMA foreign_key_check` | — | **0 violações** |

### 6.2 Comportamento da aplicação sobre a cópia migrada

| Passo | Resultado |
|---|---|
| `/api/health` | `setupRequired=**true**` |
| Token de bootstrap | criado, `600`, 48 bytes |
| Login da conta antiga | **401** |
| Criação do 1º admin (token válido) | `200` |
| Repetição do bootstrap | `409 setup_closed` |
| Login do novo admin + CSRF | `200` |
| `/me` sem cookie | `401` |
| Logout / pós-logout | `200` / `401` |
| `setupRequired` após criação | `false` |
| Arquivo de token após bootstrap | removido |

### 6.3 Prova de rollback

Restaurado o backup (banco + `master.key`) sobre a mesma cópia:

| Verificação | Resultado |
|---|---|
| `setupRequired` | `false` |
| Login da conta antiga | **200** |
| `ownership` | 16 (íntegro) |

---

## 7. Desenho de implementação (se A for aprovada)

**Não** como migração automática: migrações rodam no boot de qualquer deploy, e zerar contas não
pode ser efeito colateral de um restart. Proposta: **comando de operador explícito**.

`scripts/primeiro-acesso.mjs --confirmar` (rascunho):

1. exige `--confirmar` (sem flag = dry-run com relatório);
2. verifica `PRAGMA integrity_check` e recusa se não estiver `ok`;
3. cria backup verificado (banco + `master.key`) antes de tocar em nada;
4. executa a transação do §4 (drop triggers → aposentar → limpar sessões/tokens → recriar);
5. grava `auth.accounts_retired` com `{ admins: n, sessions: n, tokens: n }` (sem identificadores);
6. valida pós-condições: `active=0`, `sessions=0`, `tokens=0`, `integrity ok`, `fk ok`;
7. em falha: rollback da transação e instrução de restauração do backup;
8. imprime `setupRequired` e o **caminho** do arquivo de token (nunca o token).

**Idempotência:** segunda execução não encontra `active=1` nem hash válido → no-op que apenas
revalida as pós-condições.

**Impacto em código de produto:** nenhum obrigatório (F7 já garante o comportamento). Mudanças
opcionais recomendadas: filtrar `listAdmins` por `active=1` (Q4) e mensagem clara no painel para
“conta aposentada”.

---

## 8. Matriz de testes e critérios de aceitação

| # | Critério | Como verificar | Resultado na prova |
|---|---|---|---|
| T1 | Integridade SQLite | `PRAGMA integrity_check` antes/depois | ✅ |
| T2 | Zero órfãos | `PRAGMA foreign_key_check` | ✅ 0 |
| T3 | Zero admins ativos | `COUNT(*) WHERE active=1` | ✅ 0 |
| T4 | Zero sessões/tokens | `COUNT(*)` em ambas | ✅ 0 |
| T5 | Zero identidades autenticáveis | login antigo → 401 | ✅ |
| T6 | `setupRequired=true` | `/api/health` | ✅ |
| T7 | Bootstrap de uso único | token → 200; repetição → 409 | ✅ |
| T8 | Primeiro admin funcional | login + `/me` + logout | ✅ |
| T9 | Preservação de propriedade | contagens de `ownership`/`agents`/`memories` | ✅ |
| T10 | Preservação de conversas/settings | contagens | ✅ |
| T11 | Auditoria preservada | contagem + evento novo | ✅ |
| T12 | Rollback | restaurar backup → login antigo 200 | ✅ |
| T13 | Idempotência | segunda execução = no-op | a implementar no script final |
| T14 | Sem segredos em logs | varredura | ✅ |

Critério de reprovação: qualquer T1–T12 falhando bloqueia a operação; nenhum teste pode ser
enfraquecido para obter PASS.

---

## 9. Backup, recuperação e rollback

- Backup obrigatório **antes** da operação: `.backup` do SQLite + `master.key`, ambos `600`,
  diretório `700`, fora do repositório (`docs/BACKUP-E-RESTAURACAO.md`).
- Rollback: parar o serviço, restaurar `jarvis.db` + `master.key`, remover `-shm`/`-wal`, subir.
- Ensaio de rollback **já executado** (§6.3).
- A operação não altera `ownership`, `conversations` nem `admin_settings`; logo o rollback só é
  necessário para recuperar o acesso, não a integridade.

---

## 10. Riscos residuais

| Risco | Mitigação |
|---|---|
| Linhas aposentadas visíveis na UI | filtrar `active=1` em `listAdmins` (Q4) |
| Reativação acidental de conta aposentada | hash `!retired` inválido; exige criação nova |
| Operador roda o script por engano | `--confirmar` obrigatório + backup automático + dry-run |
| Perda do `master.key` no backup | procedimento documentado e ensaiado |
| Auditoria sem trilha da operação | evento `auth.accounts_retired` com contagens |

---

## 11. Condições de autorização e decisões pendentes

**Decisão de produto necessária (Q1):** aceitar “zero identidades autenticáveis, 7 âncoras
inativas” (A) **ou** exigir “zero linhas” (A'/B, com perda de vínculo ou de dados).

Antes de implementar:

1. decisão Q1 (+ Q2/Q3/Q4 conforme a opção);
2. revisão independente de segurança e integridade deste ADR;
3. implementação do script com testes T1–T14;
4. ensaio completo em cópia atualizada;
5. autorização explícita para a operação em produção, com janela e backup.

---

## 12. Veredito

**`NEEDS-PRODUCT-DECISION`**

- O design da Opção A está **provado em isolamento** (T1–T12 verdes) e é o de menor risco.
- A execução em produção permanece **não autorizada** e não foi feita.
- G9 **não está concluído**: a produção continua com a conta administrativa ativa e
  `setupRequired=false`.

### Revisão independente solicitada

Revisar especificamente: (a) se `active=0` + hash `!retired` elimina toda via de autenticação;
(b) se a remoção dos triggers de proteção dentro da transação abre janela para estado inválido;
(c) se o evento de auditoria é suficiente como trilha; (d) se a Opção A atende ao requisito de
“nenhuma conta antiga” sob a interpretação da Q1.

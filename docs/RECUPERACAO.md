# Backup, migração, recuperação e rollback

> Esquema atual do repositório: v19. Preserve sempre o par banco SQLite + `master.key`.

## Como as migrações funcionam

- A versão do banco fica em `PRAGMA user_version` de `data/jarvis.db`.
- Ao iniciar, o serviço compara a versão com a última migração conhecida (`server/migrations.js`).
- **Antes de qualquer alteração**, é criado `data/backups/jarvis-<data>-v<versão>.db` com `VACUUM INTO` e o serviço **verifica** a cópia:
  - `PRAGMA integrity_check` = `ok`;
  - número de linhas idêntico ao original em `kv`, `memories`, `agents`, `bots`, `runs`, `approvals`, `audit`.
    Se a verificação falhar, nada é migrado e o serviço não inicia.
- Cada migração roda em uma única transação (`BEGIN IMMEDIATE … COMMIT`). Antes do `COMMIT`, a contagem e o conteúdo (SHA-256 de cada linha, em ordem de rowid) das tabelas preservadas são conferidos de novo. Qualquer erro → `ROLLBACK`: o banco permanece exatamente na versão anterior, sem estado parcial.
- Rodar de novo é seguro (idempotente): sem migrações pendentes não há backup nem alteração.

## A migração v1 (Fase 1)

Só **adiciona** tabelas: `admins`, `sessions`, `login_attempts`, `service_tokens`, `bootstrap` e gatilhos que limitam a 2 administradores e protegem o último ativo. Nenhuma linha existente é alterada. Bots antigos **não** recebem proprietário automaticamente; continuam funcionando e cada execução é auditada como `legacy_unowned`. Novos bots registram `owner_admin_id`.

## Restaurar um backup (rollback manual)

1. Pare o Jarvis (feche a janela ou `Ctrl+C`).
2. Guarde o banco atual: renomeie `data/jarvis.db` para `data/jarvis.db.depois`.
   Remova também `data/jarvis.db-wal` e `data/jarvis.db-shm`, se existirem.
3. Copie o backup desejado de `data/backups/` para `data/jarvis.db`.
4. Volte o código para a versão correspondente (ex.: `git checkout v1.0.0`). Uma versão nova do código aplicaria a migração outra vez ao iniciar.
5. Inicie o Jarvis. As chaves cifradas continuam válidas porque `data/master.key` não muda.

> **`data/master.key` faz parte do conjunto de restauração.** Um banco restaurado **sem** a
> master.key correspondente falha na desencriptação (AES-256-GCM) e o serviço não sobe — verificado
> em ensaio real em 2026-10-18 (§"Ensaio de restauração isolado"). Guarde a master.key em local
> seguro e offline (nunca no repositório, nunca em nuvem sem proteção): sem ela os backups são
> ilegíveis, e com ela alguém com acesso ao arquivo pode ler os segredos cifrados.

Verificar um backup manualmente:

```bash
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(d.prepare('PRAGMA integrity_check').get(), d.prepare('PRAGMA user_version').get())" data/backups/<arquivo>.db
```

## Ensaio de restauração isolado (2026-10-18, P0.2)

Nada abaixo substituiu o banco de produção: tudo correu sobre **cópias** em diretórios temporários,
com a fonte aberta somente para leitura (tamanho+mtime verificados no fim).

**Inventário dos backups existentes** (`data/backups/`, 2 ficheiros — não remover sem autorização):

| Ficheiro                                             | Esquema | Integridade | admins | memórias | aprovações | auditoria |
| ---------------------------------------------------- | ------- | ----------- | ------ | -------- | ---------- | --------- |
| `jarvis-2026-10-18T04-47-06-450Z-pre-v10.db`         | 9       | ok          | 2      | 4        | 2          | 42        |
| `jarvis-2026-10-18T05-31-47-693Z-pre-painel-p0-1.db` | 10      | ok          | 2      | 4        | 2          | 42        |

**Ensaio positivo** (procedimento documentado acima: banco + `master.key`):

1. Cópia do backup v10 para diretório temporário + cópia de `data/master.key`;
2. arranque do serviço real (`server/index.js`) numa porta livre com `JARVIS_DATA_DIR` temporário;
3. resultado observado:
   - `/api/health` → `ok:true`, `setupRequired:false` (administradores sobreviveram à restauração);
   - `/api/auth/me` sem sessão → **401** (barreira de sessão ativa);
   - migração automática `10 → 11` com **backup verificado** gerado no diretório temporário;
   - `integrity_check = ok`, 2 administradores, 4 memórias, tabela `session_focus` criada;
   - backup de produção **intacto** (tamanho e mtime iguais).

**Ensaio negativo** (sem `master.key`): a migração corre, mas o serviço falha ao desencriptar os
segredos existentes e não sobe. Confirma que a master.key não é opcional na restauração.

**Recomendação de retenção (não implementada — decisão do dono):** manter os backups pré-migração e
um backup semanal, com um teto (ex.: 10 ficheiros ou 90 dias) e expurgo manual explícito. Hoje não
há expurgo automático: a política fica com quem opera a máquina.

## Perdi o acesso de administrador

- Se existe um segundo administrador ativo, ele pode entrar e desativar/recriar o outro.
- Sem nenhum administrador acessível (recuperação local, exige acesso ao computador):
  1. Pare o Jarvis e faça uma cópia de `data/jarvis.db`.
  2. Rode `node server/recuperar-acesso.js` — desativa todos os administradores, revoga todas as sessões e tokens, e grava um novo código de primeiro acesso.
  3. Inicie o Jarvis e conclua o primeiro acesso no painel. Memórias, agentes, bots e configurações são preservados.

## Trocar a senha (rotina, com sessão ativa)

- Com acesso normal ao painel: **Configurações → Segurança → Trocar senha** (senha atual, nova senha e
  confirmação; mínimo de 12 caracteres). Nenhuma senha passa por URL, armazenamento local ou log.
- A troca exige sessão válida + CSRF, usa a verificação **scrypt** existente e é **atômica**: a nova
  senha é gravada e **todas as outras sessões do mesmo administrador são encerradas** na mesma
  transação (a sessão que trocou continua válida; sessões revogadas não voltam a valer).
- Auditada como `auth.password_changed` (sem senha ou hash); recusas registram
  `auth.password_change_denied` com motivo (`weak_password` ou `reauth_failed`).
- Não existe redefinição por e-mail nem atalho equivalente: sem acesso, o caminho é o break-glass acima.

## Primeiro acesso

O código fica em `data/bootstrap-token.txt` (permissão `0600` no Linux; no Windows, valem as permissões da pasta do usuário). Ele vale 15 minutos, funciona uma vez e é trocado a cada reinício enquanto não houver administrador. O código não aparece no terminal nem nos logs.

## Migração v19 — valores de preenchimento Playwright

A v19 transforma, no próprio registro, `browser_action.fill.params.text` em payload cifrado com a
`master.key` local. O estado da aprovação, fingerprint, correlação e contagem de registros são
preservados. A migração exige backup verificado e executa em transação; sem a chave existente ou se
uma linha não puder ser convertida, o startup falha e a transação é revertida.

Em falha de migração:

1. Não apague nem regenere `data/master.key` e não edite `server/migrations.js` para contornar a
   falha.
2. Preserve os logs de erro sanitizados e o backup `pre-v19` que foi criado antes da transação.
3. Se for necessário voltar o código, pare o serviço, restaure o backup pré-v19 com sua
   `master.key` correspondente e só então inicie a versão anterior. O payload já migrado não deve
   ser reaberto por SQL manual.
4. Confirme `PRAGMA integrity_check = ok`, `PRAGMA user_version` e a saúde HTTP antes de retomar o
   tráfego.

Para a candidata Playwright, use apenas os volumes do projeto
`jarvis-browser-candidate`. `docker compose ... down --volumes` dessa candidata descarta dados e
sockets temporários; não aponte esses comandos para `/opt/laytech-ai/AssistentePessoal/data`.

## A migração v2 (Fase 2 — isolamento)

Cria apenas tabelas novas: `ownership`, `admin_settings`, `global_settings`, `legacy_settings`, `legacy_claims`. Nenhuma tabela existente é alterada (contagem e SHA-256 conferidos).

- Proprietário só vem de origem comprovável: bot com `owner_admin_id` gravado na Fase 1 **e** administrador existente; execuções desses bots. Memórias, agentes, aprovações e demais bots/execuções ficam **sem proprietário** e bloqueados.
- `kv.settings` é copiado byte a byte para `legacy_settings` (inativo). Para `global_settings` vão só `host`, `integrations` e `voice.localVoiceUrl`, sem ampliar a allowlist.
- O relatório de propriedade (contagens) fica na auditoria como `migration.v2_report`.
- Atribuição: Configurações → Segurança → "Dados antigos". Só metadados aparecem; a atribuição é explícita, atômica e auditada. As configurações antigas são assumidas inteiras por um único administrador que ainda não tenha configurações pessoais.
- Rollback: restaure o backup `jarvis-<data>-v1.db` (passos acima) e volte o código para a versão da Fase 1.
- Atenção: `recuperar-acesso.js` desativa administradores; recursos que eram deles continuam pertencendo a eles e ficam inacessíveis (não são reatribuídos).

## As migrações v7/v8 (Fase H — histórico de conversas)

A v7 cria apenas tabelas novas: `conversations` e `conversation_messages` (+ índices). A v8 apenas **acrescenta** a coluna `agent_id` em `conversations` (`ALTER TABLE`, aditivo). Nenhuma tabela existente é alterada (contagem e SHA-256 conferidos, como nas demais migrações). A v8 existe porque a v7 já havia sido aplicada em instalações existentes quando a coluna foi introduzida — a v7 permanece exatamente como aplicada e quem já a tem roda só a v8.

- A conversa pertence ao **próprio administrador** (coluna `conversations.admin_id`), não à tabela `ownership`: ela **nunca** é reivindicada nem transferida — nasce e morre com o dono. Toda consulta é filtrada pelo dono; "não existe" e "não é sua" respondem o mesmo (404).
- Cada mensagem tem papel `user`/`assistant`, `client_msg_id` (idempotência: reenvio/retry não duplica) e `reply_to` (no máximo uma resposta por mensagem). O contexto enviado ao modelo é **reconstruído do banco** (últimas 40 mensagens daquela conversa), nunca do que o navegador manda.
- `agent_id` (opcional) fixa o agente/modelo escolhido **para aquela conversa** na criação; não altera as configurações globais nem as outras conversas. Se o agente for excluído depois, a conversa volta ao padrão do administrador.
- **Excluir uma conversa** (painel: lista → ícone de lixeira → confirmação; API: `DELETE /api/conversations/:id`) remove a conversa e **todas as suas mensagens na mesma transação**, com auditoria sem conteúdo (`conversation.deleted`, só ids e contagem). Memórias, documentos, outras conversas e configurações **não são afetados**.
- Rollback: restaure o backup `jarvis-<data>-v6.db` (passos acima) e volte o código para a versão anterior à Fase H.

### Exclusão de conversas × backups (retenção)

Excluir no painel **não** remove a conversa dos **backups já criados** (`data/backups/`). Backups são cópias históricas e ficam como estão até serem apagados manualmente — planeje a retenção (quantos/quais manter) de acordo com a sensibilidade do conteúdo. Se o pedido for de apagamento completo, além de excluir no painel é preciso remover os arquivos de backup relevantes e confirmar que não há cópias fora do Jarvis.

## A migração v9 (Fase II — correlação estruturada)

A v9 é **aditiva e idempotente**. Ela:

- **acrescenta** a coluna `correlation_id` em `approval_actions` (`ALTER TABLE`, aditivo);
- **preenche** (backfill) a coluna a partir de `action.correlation` do JSON; registros sem correlação ficam `NULL`;
- cria o índice `idx_approval_actions_correlation`;
- cria dois gatilhos de integridade na tabela `audit`: `trg_audit_no_update` e `trg_audit_no_delete`, que **bloqueiam** `UPDATE`/`DELETE` via SQL (`RAISE(ABORT,'audit_immutable')`).

Nenhuma tabela preservada é alterada (contagem e SHA-256 conferidos, como nas demais migrações).

- A aplicação grava a coluna **quando ela existe** (capacidade detectada explicitamente no boot via `PRAGMA table_info`) e **mantém** `action.correlation` no JSON durante a transição. A leitura **prefere a coluna** quando preenchida e usa o JSON como **fallback** para registros legados (v8). Se coluna e JSON **divergirem**, o serviço não escolhe em silêncio: registra `audit.correlation_mismatch` (sanitizado) e mantém a coluna como valor seguro.
- Os gatilhos tornam a trilha **append-only para o SQL do serviço** — não contra quem tem acesso direto ao arquivo do banco (ou usa `PRAGMA writable_schema`). **Não** declarar a auditoria imutável contra administradores do banco.
- `trg_audit_no_delete` **impede** um `DELETE` normal em `audit`. Uma política de **retenção/expurgo de auditoria** ainda **não** existe e exige decisão explícita (um expurgo futuro precisa de um caminho próprio e deliberado, não um `DELETE` genérico).
- Rollback: restaure o backup `jarvis-<data>-v8.db` (passos acima) e **volte o código** para a versão anterior à v9.

### Ordem segura de implantação e rollback (código + banco)

A coluna é aditiva e o código tolera v8 **e** v9, mas o código e o esquema devem andar juntos:

- **Implantar (subir):** primeiro o **código** (que detecta a capacidade e grava a coluna só se ela existir) e, no mesmo boot, a **migração v9** roda sozinha (backup verificado antes). Nunca editar uma migração já liberada.
- **Rollback:** **pare** o serviço → restaure o backup `jarvis-<data>-v8.db` → **volte o código** para a versão correspondente → inicie. Um código novo sobre um banco v8 **funciona** (a coluna é detectada como ausente), mas um código que passe a **depender** da coluna quebraria — por isso a regra é sincronizar sempre código↔esquema no rollback.
- Backups **não** são removidos pela migração nem pelo rollback; a retenção dos arquivos em `data/backups/` é decisão humana (ver a subseção de retenção acima).

## Assumir memórias sem proprietário (operação administrativa explícita)

Memórias criadas antes da Fase 2 ficam **sem proprietário**: não aparecem na lista, na busca nem podem
ser editadas/excluídas por nenhum administrador. Elas **não** são reivindicadas, movidas ou apagadas
automaticamente — a operação é sempre humana, explícita e auditada.

- Caminho suportado no painel: **Configurações → Segurança → "Dados antigos"** → marcar os itens do tipo
  **Memórias** → **Assumir selecionados** → confirmação. API equivalente: `POST /api/legacy/claim`
  (`session`, `confirm: "ASSUMIR"`).
- A reivindicação é atômica (todos os ids precisam existir, ser únicos e ainda estar sem dono), grava
  `origin='claimed'` e é auditada (`legacy.claimed`).
- Enquanto não houver reivindicação, as memórias permanecem **inalteradas e invisíveis** — inclusive na
  busca semântica (isolamento coberto por `tests/isolation.test.mjs` e `tests/d-rec.test.mjs`).

## D_REC — Política de recuperação, reivindicação e propriedade (proposta para aprovação)

Esta seção formaliza a política de recuperação de acesso e de propriedade de recursos. Vale para as
Fases 1 e 2 e é pré-requisito das fases seguintes. **Status: proposta — aguarda aprovação.**

### 1. Recuperação de credenciais (break-glass local)

- A recuperação é **local**: exige acesso ao computador e o serviço **parado**. Não existe recuperação remota.
- Procedimento (`node server/recuperar-acesso.js`), sempre com **backup verificado antes**:
  1. desativa **todos** os administradores;
  2. revoga **todas** as sessões e tokens de serviço;
  3. recria os gatilhos de proteção do último administrador;
  4. grava um novo código de primeiro acesso (`data/bootstrap-token.txt`, uso único, 15 min).
- O que **não** muda: memórias, agentes, bots, execuções, aprovações, documentos e configurações
  permanecem intactos.
- **Proibido**: reatribuir, apagar ou “herdar” recursos durante a recuperação.

### 2. Identidade e validação

- Toda operação privilegiada (reivindicar recursos, assumir configurações antigas, criar/desativar
  administradores) exige **sessão de administrador verificada** (`isVerifiedAdmin()`), com CSRF.
- A recuperação break-glass exige acesso físico/lógico ao host; ela **não concede privilégio por si
  só** — apenas reabre o primeiro acesso, que exige o código de uso único.

### 3. Reivindicação voluntária e granular de recursos órfãos

- Recursos sem proprietário (legado) ficam **invisíveis** até reivindicação explícita.
- A reivindicação é **voluntária** (o administrador escolhe) e **granular** (por item; a API aceita
  uma lista de ids de um único tipo), com confirmação literal (`confirm: "ASSUMIR"`).
- É **atômica**: todos os ids precisam existir, ser únicos e ainda estar sem dono, revalidados dentro
  da transação; qualquer falha desfaz tudo.
- Aprovações órfãs pendentes são **invalidadas** (`legacy_expired`) na mesma transação — nunca se
  tornam executáveis por herança.
- A reivindicação grava `origin='claimed'` e é auditada (`legacy.claimed`).

### 4. Auditoria

- São auditados, entre outros: `auth.setup_first_admin`, `auth.login*`, `auth.admin_created`,
  `auth.admin_disabled`, `auth.recovery`, `auth.password_changed`, `auth.password_change_denied`,
  `legacy.claimed`, `legacy.approvals_expired`, `legacy.settings_claimed`, `agent.created/updated/deleted`,
  `authz.denied`, `authz.tool_denied`, `run_command(requested|approved|denied)`.
- A auditoria é **sanitizada** (`sanitizeAudit`): nunca grava segredos, tokens, senhas ou conteúdo de
  mensagens.

### 5. Categorias de recursos e o que se aplica a cada uma

| #   | Categoria                                          | Situação                          | Acesso hoje                                                     |
| --- | -------------------------------------------------- | --------------------------------- | --------------------------------------------------------------- |
| 1   | Recuperação de credenciais / primeiro acesso       | break-glass local (§1)            | reabre o primeiro acesso; **não** concede propriedade           |
| 2   | Recursos **sem proprietário comprovável** (legado) | nunca tiveram dono                | invisíveis; reivindicáveis por **reivindicação explícita** (§3) |
| 3   | Recursos **vinculados a administrador desativado** | têm dono, mas o dono está inativo | **bloqueados para todas as identidades**                        |
| 4   | Reivindicação futura dos recursos da categoria 3   | **não existe hoje**               | **indisponível** até procedimento aprovado e implementado       |

### 6. Invariantes (não negociáveis)

- Recuperar acesso **não** concede propriedade automática.
- Criar uma nova conta **não** transfere recursos existentes.
- Recursos de uma administradora desativada permanecem **bloqueados para outras identidades**.
- A reivindicação dos recursos da **categoria 3** permanece **indisponível** até existir procedimento
  **aprovado e implementado** — não basta a política estar escrita.
- **Não** permitir acesso ao **conteúdo privado** durante a triagem (só metadados).
- **Não** reativar automaticamente tokens, bots, aprovações ou credenciais de e-mail ao recuperar acesso.
- Qualquer transferência futura deve ser **granular, voluntária, auditada e resistente a concorrência**
  (transação atômica; sem execução dupla).
- O expurgo deve tratar **banco, arquivos e dados derivados**; **não** prometer atomicidade única entre
  SQLite e o sistema de arquivos (o arquivo é removido após a transação, tolerando falha parcial).

### 7. Pendência aberta (bloqueador)

- **Reatribuição de recursos de administrador desativado (categorias 3 e 4):** hoje **não implementada**.
  A política proíbe a transferência automática e **não** promete que a reivindicação desses recursos já
  exista. Enquanto não houver procedimento aprovado e implementado, esses recursos permanecem
  **inacessíveis**. Decisão mínima necessária: definir se/como um administrador ativo pode reivindicar
  recursos de um administrador desativado (com auditoria e concorrência segura), ou manter o bloqueio.
- **Não** implementar endpoints de transferência ou expurgo nesta fase; esta seção formaliza a política
  e registra o bloqueio.

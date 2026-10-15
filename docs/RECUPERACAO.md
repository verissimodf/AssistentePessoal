# Backup, migração, recuperação e rollback

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

Verificar um backup manualmente:
```bash
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(d.prepare('PRAGMA integrity_check').get(), d.prepare('PRAGMA user_version').get())" data/backups/<arquivo>.db
```

## Perdi o acesso de administrador
- Se existe um segundo administrador ativo, ele pode entrar e desativar/recriar o outro.
- Sem nenhum administrador acessível (recuperação local, exige acesso ao computador):
  1. Pare o Jarvis e faça uma cópia de `data/jarvis.db`.
  2. Rode `node server/recuperar-acesso.js` — desativa todos os administradores, revoga todas as sessões e tokens, e grava um novo código de primeiro acesso.
  3. Inicie o Jarvis e conclua o primeiro acesso no painel. Memórias, agentes, bots e configurações são preservados.

## Primeiro acesso
O código fica em `data/bootstrap-token.txt` (permissão `0600` no Linux; no Windows, valem as permissões da pasta do usuário). Ele vale 15 minutos, funciona uma vez e é trocado a cada reinício enquanto não houver administrador. O código não aparece no terminal nem nos logs.

## A migração v2 (Fase 2 — isolamento)
Cria apenas tabelas novas: `ownership`, `admin_settings`, `global_settings`, `legacy_settings`, `legacy_claims`. Nenhuma tabela existente é alterada (contagem e SHA-256 conferidos).
- Proprietário só vem de origem comprovável: bot com `owner_admin_id` gravado na Fase 1 **e** administrador existente; execuções desses bots. Memórias, agentes, aprovações e demais bots/execuções ficam **sem proprietário** e bloqueados.
- `kv.settings` é copiado byte a byte para `legacy_settings` (inativo). Para `global_settings` vão só `host`, `integrations` e `voice.localVoiceUrl`, sem ampliar a allowlist.
- O relatório de propriedade (contagens) fica na auditoria como `migration.v2_report`.
- Atribuição: Configurações → Segurança → "Dados antigos". Só metadados aparecem; a atribuição é explícita, atômica e auditada. As configurações antigas são assumidas inteiras por um único administrador que ainda não tenha configurações pessoais.
- Rollback: restaure o backup `jarvis-<data>-v1.db` (passos acima) e volte o código para a versão da Fase 1.
- Atenção: `recuperar-acesso.js` desativa administradores; recursos que eram deles continuam pertencendo a eles e ficam inacessíveis (não são reatribuídos).

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
  `auth.admin_disabled`, `auth.recovery`, `legacy.claimed`, `legacy.approvals_expired`,
  `legacy.settings_claimed`, `authz.denied`, `authz.tool_denied`, `run_command(requested|approved|denied)`.
- A auditoria é **sanitizada** (`sanitizeAudit`): nunca grava segredos, tokens, senhas ou conteúdo de
  mensagens.

### 5. Proibição de transferência automática
- **Nenhum** recurso órfão é atribuído automaticamente — nem na migração v2, nem na recuperação de
  acesso, nem ao desativar um administrador.
- Ao desativar um administrador, os recursos que pertenciam a ele permanecem com ele e ficam
  **inacessíveis**; só voltam a ser acessíveis por **reivindicação explícita e auditada**.
- Bots sem dono comprovável não executam (`legacy_blocked`).

### 6. Pendência aberta (a decidir)
- **Recuperação da propriedade após recuperação de acesso.** Quando um administrador é desativado por
  `recuperar-acesso.js`, os recursos dele ficam órfãos de fato (dono inativo) e **não há**, hoje, um
  caminho aprovado para reatribuí-los. Esta política **proíbe a transferência automática**; a
  reatribuição exige decisão explícita (reivindicação), que ainda **não está implementada** para
  recursos cujo dono foi desativado. Decisão mínima necessária: definir se/como um administrador ativo
  pode reivindicar recursos de um administrador desativado (com auditoria), ou manter o bloqueio.

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

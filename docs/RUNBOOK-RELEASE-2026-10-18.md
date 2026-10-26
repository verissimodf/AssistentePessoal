# Runbook de release — P0.3 (2026-10-18)

## Release atual — 1.7.8 (2026-10-25)

| Item | Valor |
| --- | --- |
| Versão | `1.7.8` (`package.json`) |
| Esquema | `12` (`PRAGMA user_version`, migração `document_chunks`) |
| Compose ativo | `docker-compose.yml` (serviço `assistente`) |
| Build args | `BUILD_VERSION`, `BUILD_COMMIT`, `BUILD_COMMIT_STATUS`, `SCHEMA_VERSION`, `BUILD_TIME`, `RELEASE_BUILD=1` |
| Health | `/api/health` expõe `version`, `commit`, `commitStatus`, `schemaVersion`, `schemaVersionBuild`, `buildTime` |

```bash
cd /opt/laytech-ai/AssistentePessoal
COMMIT_SHA=$(git rev-parse HEAD)
SHORT_SHA=$(git rev-parse --short HEAD)
VERSION=$(node -p 'require("./package.json").version')
STATUS="Registrado"   # use "Não registrado (local)" se a árvore não estiver na main remota
export BUILD_VERSION="$VERSION" BUILD_COMMIT="$COMMIT_SHA" \
       BUILD_COMMIT_STATUS="$STATUS" SCHEMA_VERSION=12 \
       BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) RELEASE_BUILD=1
export IMAGE_TAG="$SHORT_SHA"
docker compose -f docker-compose.yml build
bash scripts/verificar-imagem-release.sh "assistente-pessoal:$IMAGE_TAG" "$COMMIT_SHA" "$VERSION"
docker compose -f docker-compose.yml up -d
curl -s http://192.168.2.40:7777/api/health
```

O health esperado contém `"version":"1.7.8"`, `"commit":"<SHA>"`, `"commitStatus":"Registrado"`,
`"schemaVersion":12`. As seções históricas abaixo (P0.3, 2026-10-18) permanecem como registro.

---

Runbook do release candidato **P0.3** sobre o J.A.R.V.I.S. em produção. Neste documento
consta exatamente o que foi validado, o que falta validar e o que **exige autorização do dono**.
**Nenhum destes passos foi executado em produção** — apenas em cópias isoladas e num contentor
de teste descartável.

> **Estado do gate (P0.3.1, 2026-10-18): AUTORIZADO.** O dono autorizou nesta release: commit,
> CI, merge, publicação da imagem, backup, **deploy em produção**, migração v11 e limpeza
> controlada. A correção de metadados (§7) foi incluída nesta release, com CI verde, e a imagem
> final é verificada por `scripts/verificar-imagem-release.sh` antes do deploy. As credenciais de
> teste dedicadas para smoke autenticado continuam a exigir decisão do dono (§6).

---

## 1. Identidade do release

| Item | Valor | Como foi obtido |
| --- | --- | --- |
| Branch | `main` | `git branch --show-current` |
| Commit | `1972e00b4e2d2a88516df7e29fd2227260bfa5d6` | `git rev-parse HEAD` |
| Versão (`APP_VERSION`) | `1.0.0` | `node -p 'require("./package.json").version'` (fonte versionada; **não inventada**) |
| Build-time do candidato validado | `2026-10-18T16:53:26Z` | `server/build-info.json` dentro da imagem |
| Digest da imagem candidata validada (`p0.3-rc2`) | `sha256:bf71660a914606adb97f381862b02650efab2ab56c08bb58e6dc94f1541527d4` | `docker inspect assistente-pessoal:p0.3-rc2` |
| Labels OCI | `org.opencontainers.image.revision=1972e00b…`, `org.opencontainers.image.version=1.0.0` | `docker inspect … --format '{{json .Config.Labels}}'` |
| Produção atual | imagem `assistente-pessoal:1.2.2-gigabrain1`, esquema **10**, `integrity_check=ok`, `healthy` | inspeção só-leitura em 2026-10-18 |

> O candidato validado em isolamento (`p0.3-rc2`) foi construído com a correção do `Dockerfile`
> ainda no working tree; essa correção foi **commitada nesta release (P0.3.1)** e a imagem
> definitiva é reconstruída a partir do commit aprovado em `main` e verificada de ponta a ponta
> por `scripts/verificar-imagem-release.sh` (labels OCI + `build-info.json` + health do serviço).

## 2. Pré-requisitos (obrigatórios antes do deploy)

1. **Correção dos metadados de build incluída no commit da release (§7)** + CI verde
   (ubuntu + windows). Sem isso, a imagem de produção reportaria
   `version/commit = unknown` ("Não registro") e sem label OCI.
2. **Autorização explícita do dono** para: deploy/re-imagem, migração v11 em produção, criação de
   credenciais de teste dedicadas (smoke autenticado) e política de retenção (§8).
3. Docker Engine acessível; rede `CNC_APP_PROD_01` existente; serviço `nginx-app` ativo.
4. Espaço em disco: imagem ≈ 2,2 GB; banco ≈ 344 KB + WAL ≈ 4 MB; backups ≈ 660 KB.
5. Janela combinada com o dono (a API/painel ficam indisponíveis durante a recriação do contentor).

## 3. Backup pré-migração (antes de mexer em qualquer coisa)

A própria migração cria e **verifica** automaticamente um backup
(`data/backups/jarvis-<ISO>-v10.db` antes de aplicar a v11). Faça **também** uma cópia manual
redundante e guarde-a fora da máquina:

```bash
cd /opt/laytech-ai/AssistentePessoal
DB=data/jarvis.db
TS=$(date -u +%Y%m%dT%H%M%SZ)
cp --preserve=mode,timestamps "$DB" "data/backups/manual-$TS-prerelease-v10.db"
cp data/master.key "data/backups/manual-$TS-master.key"   # master.key = parte OBRIGATÓRIA do conjunto
sha256sum data/backups/manual-$TS-* | tee "data/backups/manual-$TS.sha256"
integridade=$(node --no-warnings -e 'import("node:sqlite").then(({DatabaseSync})=>{const d=new DatabaseSync(process.argv[1],{readOnly:true});console.log(d.prepare("PRAGMA integrity_check").get().integrity_check)})' "$DB")
echo "integridade=$integridade"   # tem de ser "ok"
```

**Não remova nenhum backup existente.** Backups atuais (registrados para preservação de
evidência):

| Ficheiro | SHA-256 | Esquema |
| --- | --- | --- |
| `jarvis-2026-10-18T04-47-06-450Z-pre-v10.db` | `a5033be42cf0f0beec08085531dec47f1f5e6ac18530fd5cec5bec8621554092` | 9 |
| `jarvis-2026-10-18T05-31-47-693Z-pre-painel-p0-1.db` | `35ea462a68cfeffb48c70e349fc97966511b3b19450f742a3cf44e2a7003b926` | 10 |

## 4. Janela e impacto esperado

- **Duração esperada:** 1–3 min (recriação do contentor + migração no arranque).
- **Impacto:** API e painel fora do ar durante a recriação; áudio (voz) depende do serviço externo
  `xtts-service` (não reiniciado). Nenhuma porta publicada no host muda; o IP fixo
  `192.168.2.40` e o DNS do serviço são preservados pelo compose.
- **Migração v11:** cria `session_focus` (uma tabela nova, **somente aditiva**). Nenhum dado
  existente é alterado; a framework compara contagens antes/depois e desfaz tudo se mudar.

## 5. Deploy (após autorização)

```bash
cd /opt/laytech-ai/AssistentePessoal
git pull --ff-only origin main          # tem de incluir a correção do Dockerfile (§2/§7)
GIT_SHA=$(git rev-parse HEAD)           # SHA explícito — nunca inferido do branch
APP_VERSION=$(node -p 'require("./package.json").version')
export GIT_SHA APP_VERSION BUILD_TIME=$(date -u +%Y-%m-%dT%H:%M:%SZ) RELEASE_BUILD=1
export IMAGE_TAG="$APP_VERSION"      # tag da release; a tag anterior fica como rollback
docker compose -f docker-compose.yml build
bash scripts/verificar-imagem-release.sh "assistente-pessoal:$IMAGE_TAG" "$GIT_SHA" "$APP_VERSION"  # tem de APROVAR
docker compose -f docker-compose.yml up -d
```

O `compose` injeta `GIT_SHA`/`APP_VERSION`/`BUILD_TIME`/`RELEASE_BUILD` como build args; o processo
em runtime **não tem git** e nunca infere a versão — se o arg faltar, o painel mostra "Não
registrado" em vez de inventar. `RELEASE_BUILD=1` torna a validação dos metadados ESTRITA: sem
SHA completo, versão e instante RFC3339 o build **falha** (nunca uma imagem com "unknown").

## 6. Verificações pós-arranque

```bash
docker compose -f docker-compose.yml ps          # healthy
docker compose -f docker-compose.yml logs | grep -E "schema|backup verificado"
#   esperado: [db] schema v10 → v11; backup verificado em /app/data/backups/jarvis-<ISO>-v10.db
docker inspect assistente-pessoal --format '{{json .Config.Labels}}'   # revision/version reais
docker exec assistente-pessoal cat /app/server/build-info.json         # commit = GIT_SHA acima
curl -s http://192.168.2.40:7777/api/health
#   esperado: {"ok":true,"version":"1.0.0","commit":"<GIT_SHA>","buildTime":"<BUILD_TIME>","mode":"production","setupRequired":false}
node --no-warnings -e 'import("node:sqlite").then(({DatabaseSync})=>{const d=new DatabaseSync("data/jarvis.db",{readOnly:true});const q=t=>d.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;console.log({esquema:d.prepare("PRAGMA user_version").get().user_version,integridade:d.prepare("PRAGMA integrity_check").get().integrity_check,fk:d.prepare("PRAGMA foreign_key_check").all().length,admins:q("admins"),memorias:q("memories"),aprovacoes:q("approvals"),auditoria:q("audit")})})'
#   esperado: esquema=11, integridade="ok", fk=0, contagens iguais às de antes do deploy
```

Linha de referência **antes** do deploy (2026-10-18, leitura só-leitura): esquema 10,
`integrity_check=ok`, `admins=2`, `memories=4`, `approvals=2`, `audit=45`,
`session_focus` inexistente.

### Smoke autenticado (bloqueado até haver credenciais de teste dedicadas)

Com uma conta de teste **criada para o efeito** (nunca com credenciais reais de produção):

1. Login no painel; 2. `GET /api/session-focus` → 200 do próprio; 3. gravar foco e recarregar →
persiste; 4. `GET /api/settings/provenance` → origens visíveis, **sem valores**; 5. aba
Execuções → ledger real; 6. `POST /api/auth/logout` com CSRF → sessão revogada.
Sem credenciais de teste, este passo fica **bloqueado** — não substituir por simulação.

## 7. Correção incluída nesta release (metadados na imagem final)

O build do **estágio final** (`runtime`) não copiava `server/build-info.json` nem declarava os
`ARG`/`LABEL` — um `docker build` normal (`assistente-pessoal:p0.3-rc1`,
`sha256:6ccad885…`) ficou **sem label OCI e sem build-info** (verificado: `.Config.Labels=null`,
ficheiro inexistente). Causa: o escopo de um `ARG` não atravessa um `FROM` e o `COPY server/`
vinha do contexto (sem o ficheiro gerado). Correção **incluída nesta release (P0.3.1)**:

```dockerfile
# no estágio runtime:
ARG APP_VERSION=sem-build
ARG GIT_SHA=unknown
ARG BUILD_TIME=unknown
...
COPY --from=build /app/server/build-info.json ./server/build-info.json
LABEL org.opencontainers.image.revision="$GIT_SHA" \
      org.opencontainers.image.version="$APP_VERSION" \
      org.opencontainers.image.created="$BUILD_TIME"
```

Complementos desta release:

- **Validação estrita de release**: `RELEASE_BUILD=1` faz o `scripts/write-build-info.mjs` recusar
  SHA incompleto, versão ausente ou instante fora do RFC3339 — o build **falha** em vez de gravar
  "unknown" (testado em `tests/build-info.test.mjs`).
- **Asserção de esquema na migração v11** (`server/migrations.js`): `CREATE TABLE IF NOT EXISTS`
  não falha com objetos homónimos; agora cada migração pode declarar `expect` (tipo, colunas, PK)
  e a framework valida **antes do COMMIT**, com rollback (`tests/migration-assert-v11.test.mjs`).
- **Verificador de imagem de release**: `scripts/verificar-imagem-release.sh <imagem> [sha] [ver]`
  compara labels OCI + `build-info.json` + health real do serviço contra a árvore construída e
  falha em qualquer divergência.

Validado com `p0.3-rc2` (isolamento) e com `p0.3.1-precommit` (11 verificações aprovadas, incluindo
health `version=1.0.0/commit=<SHA>` e painel 200).

## 8. Critérios de abortar

Abortar e não prosseguir se qualquer um ocorrer:

- log sem `schema v10 → v11` **ou** com "falhou e foi desfeita";
- `PRAGMA integrity_check` ≠ `ok`, ou `foreign_key_check` ≠ 0;
- contagens antes/depois diferentes (a framework já aborta por si; confirmar nos logs);
- `/api/health` não responde ou `setupRequired:true` com dados já existentes;
- painel não serve (HTTP ≠ 200 em `/`) ou a API devolve erro em rotas básicas;
- qualquer linha nova de erro de aplicação nos logs.

## 9. Rollback (imagem + banco, com compatibilidade de esquema)

> **A compatibilidade de esquema é unidirecional:** a imagem atual
> (`1.2.2-gigabrain1`) conhece migrações até **v10**. Depois de o banco estar em **v11**, ela
> **não pode ser apontada cegamente** para o banco migrado — é preciso restaurar, em conjunto, a
> imagem antiga **e** o backup v10 compatível.

```bash
cd /opt/laytech-ai/AssistentePessoal
# 1) parar o serviço candidato
docker compose -f docker-compose.yml down
# 2) restaurar banco e master.key do conjunto pré-migração (parar primeiro: WAL!)
cp data/backups/manual-<TS>-prerelease-v10.db data/jarvis.db
rm -f data/jarvis.db-wal data/jarvis.db-shm      # só depois de o serviço estar parado
# 3) voltar à imagem anterior (tag já presente nesta máquina)
git checkout <commit anterior>                   # se o código também tiver de voltar
docker compose -f docker-compose.yml build
docker compose -f docker-compose.yml up -d
# 4) verificar
curl -s http://192.168.2.40:7777/api/health     # ok:true, setupRequired:false
node --no-warnings -e 'import("node:sqlite").then(({DatabaseSync})=>{const d=new DatabaseSync("data/jarvis.db",{readOnly:true});console.log(d.prepare("PRAGMA user_version").get().user_version, d.prepare("PRAGMA integrity_check").get().integrity_check)})'
#   esperado: 10 ok
```

Regras:

- `data/master.key` **não** é recriada nem substituída (ela é independente do esquema; a cópia
  `manual-<TS>-master.key` serve só para desastre de máquina, não para rollback rutineiro).
- Nunca apagar a master.key "para regenerar": sem ela, os segredos encriptados ficam perdidos
  (ensaio negativo de 2026-10-18: sem master.key o serviço **não sobe**).
- Nunca rodar `VACUUM INTO`/`cp` sobre o banco com o serviço em execução (WAL ativo).

## 10. master.key e permissões

- `data/master.key`: modo `600`, dono `laytech`; `data/` modo `750`; `data/backups/` modo `700`.
- Backups automáticos contêm **apenas o banco**; a master.key **não** é copiada. Para restauração
  em outra máquina é obrigatório levar também a master.key (guardada offline, cifrada).
- Nunca registar o conteúdo da master.key, cookies, tokens ou senhas em logs, ecrãs ou relatórios.

## 11. Evidências deste release (ensaios reais, sem tocar em produção)

| Ensaio | Resultado | Onde |
| --- | --- | --- |
| Migração v10 → v11 em cópia do banco real | esquema 11, `integrity=ok`, `fk=0`, contagens preservadas, isolamento por dono (A vê / B vazio; FK e PK recusadas) | ensaio isolado 2026-10-18 |
| Falha da migração → rollback | framework hook (`failAfterSql`) desfez tudo: esquema continuou 10, contagens iguais, sem tabela parcial | idem |
| Restauração conforme `docs/RECUPERACAO.md` | backup + master.key → serviço sobe, 401 sem sessão, migra 10→11 com backup verificado, fonte intacta | idem |
| Build candidato | labels OCI + build-info com SHA exato; `p0.3-rc1` sem metadados (corrigido em `p0.3-rc2`) | `docker build` + inspeção |
| E2E de navegador (instância isolada da fonte) | **8/8 pass** (2 execuções) | `scripts/e2e-navegador.sh` |
| E2E de navegador (contra a **imagem candidata**) | **8/8 pass**, com versão `1.0.0` e SHA reais visíveis no painel | `scripts/e2e-navegador.mjs` + contentor `p0.3-rc2` |
| Segurança em E2E isolado | 8 pass: 401 anónimo, CSRF 403 auditado (`authz.csrf_rejected`), origem não confiável 403, isolamento entre 2 admins, aprovações 401/404 uniforme | contentor descartável |
| Replay/concorrência de aprovações | **blocked** em E2E (exige provedor OpenHands real); coberto por `tests/approvals-actions.test.mjs` | — |
| Regressão de testes | backend **424/424**, painel **57/57**, build do painel ok | `node --test`, `vitest run` |
| Migração v11 com asserção de esquema (P0.3.1) | VIEW homónima → aborta com "asserção de esquema" e rollback completo (esquema 10, sem tabela parcial) | `tests/migration-assert-v11.test.mjs` + ensaio isolado |
| Imagem candidata final (pré-deploy) | 11 verificações APROVADAS: labels OCI (revision/version/created), build-info com SHA exato, health `version=1.0.0/commit=<SHA>/mode=production`, painel 200 | `scripts/verificar-imagem-release.sh` |

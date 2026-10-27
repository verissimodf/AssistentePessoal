# Backup e recuperação de desastres

Atualizado em 2026-10-27 para a release **1.8.1** (esquema SQLite **14**). A validação de 26/10
abaixo permanece como evidência histórica; o banco atual concluiu a migração v13→v14 com backup
verificado automático e `integrity_check=ok`.

## 1. Princípio

O banco sozinho **não restaura**. As configurações e segredos são cifrados com AES-256-GCM usando
`data/master.key`; sem a chave o serviço falha no boot (`walkDecrypt`). Todo backup precisa
conter **`jarvis.db` + `master.key`** (e, opcionalmente, `voices/`).

## 2. O que existe hoje

| Item | Estado |
| --- | --- |
| Script `deploy/backup-data.sh` | **existe**: `VACUUM INTO`, `master.key`, `voices/`, `SHA256SUMS.txt`, retenção de 7 |
| Timer systemd | documentado como **instalado/habilitado** (`jarvis-data-backup.timer`); última validação registrada em 2026-10-26, não revalidado nesta entrega |
| Backup externo/off-host | **hook opt-in implementado** (`JARVIS_BACKUP_REMOTE`, fail-soft via rclone); remote `gdrive:` sem OAuth válido → inativo (BLOCKED-CONFIGURATION) |
| Cifragem antes de transferência | **não implementada** |
| Alerta de falha/idade | **não implementado** |
| Restore drill periódico | **não automatizado**; ensaio manual positivo em 2026-10-18 |
| Falha do timer (2026-10-25) | script sem bit de execução (`203/EXEC`); corrigido com `chmod 755` e serviço reexecutado com sucesso em 2026-10-26 |

Validação anterior (2026-10-26): backup verificado (`sha256sum -c` — banco, chave e vozes),
`PRAGMA integrity_check=ok`, schema 12, e **ensaio de restauração isolado** com o serviço
iniciado a partir da cópia (health `ok`, `setupRequired:false`, `schemaVersion:12`,
login do admin preservado).

Validação da release 1.8.1 (2026-10-27): `VACUUM INTO` criou um backup pré-deploy e uma cópia da
`master.key`; a cópia SQLite retornou `integrity_check=ok`. Na migração v13→v14, o mecanismo de
migrações criou outro backup do banco e verificou-o antes de aplicar a transação. O primeiro par
fica em `data/backups/pre-1.8.1-20261027T202000Z.{db,master.key}` no host/container desta instalação.

Destino padrão: `/opt/laytech-ai/jarvis-data-backups/<stamp>/` (mesmo disco). Isso protege contra
erro humano/corrupção lógica, **não** contra falha de disco, ransomware ou perda do host.

## 3. RPO e RTO propostos (não aprovados)

| Métrica | Proposta | Justificativa |
| --- | --- | --- |
| RPO | **24 h** | backup diário; dados de conversa/memória toleram até um dia de perda |
| RTO | **2 h** | restore local + validação + subida do container |
| Retenção local | 7 diários + 4 semanais | equilíbrio entre espaço e rollback |
| Retenção externa | 30 dias | proteção contra perda do host |

O dono precisa aprovar RPO/RTO e o destino externo antes de qualquer implementação.

## 4. Backup consistente (manual)

```bash
B=/opt/laytech-ai/jarvis-data-backups/jarvis-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$B" && chmod 700 "$B"

# SQLite em WAL: cópia consistente sem parar o escritor
sqlite3 "file:/opt/laytech-ai/AssistentePessoal/data/jarvis.db?mode=ro" ".backup '$B/jarvis.db'"

# A chave é obrigatória
cp -a /opt/laytech-ai/AssistentePessoal/data/master.key "$B/master.key"

chmod 600 "$B"/*
sqlite3 "file:$B/jarvis.db?mode=ro" "PRAGMA integrity_check; PRAGMA user_version;"
sha256sum "$B"/* > "$B/SHA256SUMS.txt"
```

Ou use o script:

```bash
JARVIS_DATA_DIR=/opt/laytech-ai/AssistentePessoal/data \
JARVIS_BACKUP_DIR=/opt/laytech-ai/jarvis-data-backups \
JARVIS_BACKUP_KEEP=7 \
deploy/backup-data.sh
```

## 5. Copia externa (opt-in) e cifragem

O `deploy/backup-data.sh` aceita `JARVIS_BACKUP_REMOTE` (ex.: `gdrive:jarvis-backups`). Com a
variável definida, cada backup é copiado via `rclone copy` e **confirmado** (`rclone lsl`);
falha de rede/credencial é só um aviso — não invalida o backup local já verificado. Para
cifrar em trânsito/repouso, aponte a variável para um remote `crypt` do rclone (chave fora do
host). Estado atual: o remote existe mas o OAuth está vazio (`rclone config reconnect
gdrive:`) → hook **inativo** por padrão; cifragem e destino externo permanecem pendências
aprovações do dono.

Ad hoc: `gpg -c backup.tar.gpg` com `chmod 600`, chave simétrica forte entregue fora do host.

## 5b. Estratégia externa proposta

1. Gerar o backup local consistente (acima).
2. Criar um tar cifrado (ex.: `age`/`gpg`) **antes** de sair do host; a chave de cifra não pode
   ficar no mesmo host.
3. Transferir para um destino externo com permissão mínima (ex.: bucket privado ou pasta
   sincronizada), usando credencial dedicada e rotação.
4. Registrar hash/tamanho/data e verificar o checksum após a transferência.
5. Monitorar idade do último backup e falha do job; alertar se > 26 h.
6. Nunca enviar `master.key` em claro; nunca colocá-la em repositório, issue ou relatório.

Para Google Drive ou outro provedor: usar OAuth com escopo mínimo, conta dedicada, rotação de
credencial e teste de recuperação de acesso. **Nada foi enviado para destino externo nesta
auditoria.**

## 6. Restauração (testada em ambiente isolado)

1. Parar o escritor: `docker compose -f docker-compose.yml down`.
2. Preservar o estado atual: `mv data data.pre-restore.$(date +%Y%m%dT%H%M%S)`.
3. Copiar `jarvis.db`, `master.key` e `voices/` do backup; `chmod 600` no banco/chave.
4. Validar antes de subir:
   ```bash
   sqlite3 "file:data/jarvis.db?mode=ro" "PRAGMA user_version; PRAGMA integrity_check;"
   # esperado para backup atual 1.8.1: 14 e ok; versões anteriores podem ser migradas no boot
   ```
5. Subir: `docker compose -f docker-compose.yml up -d --no-build`; aguardar `healthy`.
6. Validar login, `/api/health` (schema 14 para 1.8.1), contagens de auditoria/agentes e um chat curto.
7. Rollback da restauração: parar e renomear `data.pre-restore.<stamp>` de volta.

**Nunca** faça restore sobre o banco de produção sem backup do estado atual e sem janela
autorizada. O restore drill deve usar cópia isolada, nunca o volume vivo.

## 7. Alertas e verificação

| Verificação | Comando | Esperado |
| --- | --- | --- |
| Integridade | `sqlite3 ... "PRAGMA integrity_check;"` | `ok` |
| Esquema atual | `sqlite3 ... "PRAGMA user_version;"` | `14` (1.8.1) |
| Checksums | `(cd "$BK" && sha256sum -c SHA256SUMS.txt)` | todos OK |
| Idade | `find /opt/laytech-ai/jarvis-data-backups -maxdepth 1 -type d -printf '%T@ %p\n' \| sort -n \| tail -1` | ≤ 26 h |
| Tamanho/WAL | `du -h data/jarvis.db*` | WAL < 256 MB (proposta) |

## 8. Limitações e pendências

- Backup no mesmo disco não é DR.
- Sem cifragem/off-host, um comprometimento do host expõe banco e chave juntos.
- Sem timer/alerta, o backup depende de execução manual.
- O restore drill periódico e o RPO/RTO ainda precisam de aprovação do dono.
- O diretório de backup contém dados pessoais: permissões 700/600 e acesso restrito.
